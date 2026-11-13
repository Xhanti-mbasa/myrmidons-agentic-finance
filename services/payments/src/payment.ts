import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  AccountId, PayToolRequest, TransferAccount, TransferIntentInput, TransferPermit,
  TransferPolicy, TransferReceipt, TransferRecipient, TransferResult,
  RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS, GENESIS_HASH,
  canonicalJson, auditHashInput, fromCents, toCents,
} from "../../../packages/shared/src/index";
import type { TransferCode } from "../../../packages/shared/src/index";

/** Supplied by authenticated server middleware, never taken from a tool argument/body. */
export type Principal = Readonly<{ ownerId: string; subjectId: string; role: "owner" | "agent" }>;
type Intent = TransferIntentInput & { id: string; ownerId: string; result: TransferResult;
  reserved: boolean; prepared?: PreparedTransfer; policyVersion?: number; submissionStarted?: boolean };
type Policy = { version: number; rules: TransferPolicy; spent: string; reserved: string };
export type PreparedTransfer = Readonly<{
  intentId: string; ownerId: string; sourceAccountId: string; sourceAddress: string;
  recipientId: string; recipientKind: "internal" | "person" | "vendor"; destination: string; destinationTag?: number; amount: string;
  reference: string; network: typeof XRPL_TESTNET_WSS; currency: typeof RLUSD_CURRENCY_HEX;
  issuer: typeof RLUSD_TESTNET_ISSUER; policyVersion: number; auditHash: string;
}>;
export type AuditRecord = { seq: number; ts: string; ownerId: string; intentId: string | null;
  subjectId: string; event: string; details: Record<string, string>; prevHash: string; hash: string };

/** No production implementation or signing keys are bundled here. Both adapters are mandatory. */
export type PaymentAdapters = {
  policy: { authorize(payment: PreparedTransfer, paymentDigest: string): Promise<unknown> };
  wallet: {
    /** Must independently verify the permit and actual tx, enforce Testnet and current revocation,
     * persist signing/submission identity, and never mint a new transaction on an uncertain retry. */
    submit(payment: PreparedTransfer, permit: { paymentDigest: string; authorization: string }): Promise<unknown>;
    /** Must check the actual ledger transaction against every prepared field before returning settled. */
    lookup(payment: PreparedTransfer, paymentDigest: string, txHash?: string): Promise<unknown>;
  };
};

export const paymentDigest = (payment: PreparedTransfer): string =>
  createHash("sha256").update(canonicalJson(payment)).digest("hex");
const auditDigest = (record: Omit<AuditRecord, "hash">): string =>
  createHash("sha256").update(auditHashInput(record.prevHash, record)).digest("hex");

export class PaymentError extends Error {
  constructor(public readonly code: TransferCode) { super(code); }
}

/** Durable coordinator. Use a private, owner-controlled DB path; do not share it with the agent OS user. */
export class PaymentService {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly adapters: PaymentAdapters,
    private readonly now: () => Date = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY(kind,owner,id));
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL,
        reference TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(owner,reference));
      CREATE TABLE IF NOT EXISTS audit(owner TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(owner,seq));`);
  }
  close(): void { this.db.close(); }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private principal(ctx: Principal, ownerOnly = false): void {
    if (!ctx || !AccountId.safeParse(ctx.ownerId).success || !AccountId.safeParse(ctx.subjectId).success ||
        !["agent", "owner"].includes(ctx.role) || (ownerOnly && ctx.role !== "owner"))
      throw new PaymentError("NOT_AUTHORIZED");
  }
  private get<T>(kind: string, owner: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT body FROM records WHERE kind=? AND owner=? AND id=?").get(kind, owner, id);
    return row ? JSON.parse(row.body as string) as T : undefined;
  }
  private put(kind: string, owner: string, id: string, value: unknown): void {
    this.db.prepare("INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,owner,id) DO UPDATE SET body=excluded.body")
      .run(kind, owner, id, canonicalJson(value));
  }
  private intent(ctx: Principal, id: string): Intent {
    const row = this.db.prepare("SELECT body FROM intents WHERE id=? AND owner=?").get(id, ctx.ownerId);
    if (!row) throw new PaymentError("NOT_AUTHORIZED");
    return JSON.parse(row.body as string) as Intent;
  }
  private save(intent: Intent): void {
    this.db.prepare("UPDATE intents SET body=? WHERE id=? AND owner=?")
      .run(canonicalJson(intent), intent.id, intent.ownerId);
  }
  private append(ctx: Principal, intentId: string | null, event: string, details: Record<string, string>): string {
    const last = this.db.prepare("SELECT body FROM audit WHERE owner=? ORDER BY seq DESC LIMIT 1").get(ctx.ownerId);
    const previous = last ? JSON.parse(last.body as string) as AuditRecord : undefined;
    const entry = { seq: (previous?.seq ?? 0) + 1, ts: this.now().toISOString(), ownerId: ctx.ownerId,
      intentId, subjectId: ctx.subjectId, event, details, prevHash: previous?.hash ?? GENESIS_HASH };
    const hash = auditDigest(entry);
    this.db.prepare("INSERT INTO audit VALUES(?,?,?)").run(ctx.ownerId, entry.seq, canonicalJson({ ...entry, hash }));
    return hash;
  }
  private security(ctx: Principal): { rejectedAt: number[]; locked: boolean } {
    return this.get("security", ctx.ownerId, ctx.subjectId) ?? { rejectedAt: [], locked: false };
  }
  private reject(ctx: Principal, code: TransferCode, id: string | null = null): void {
    const state = this.security(ctx);
    const now = this.now().getTime();
    state.rejectedAt = [...state.rejectedAt.filter(t => now - t < 60000), now];
    state.locked ||= state.rejectedAt.length >= 5;
    this.put("security", ctx.ownerId, ctx.subjectId, state);
    this.append(ctx, id, "request_rejected", { code });
    if (state.locked) this.append(ctx, id, "payment_authority_locked", { subjectId: ctx.subjectId });
  }
  unlock(ctx: Principal, subjectId: string): void {
    this.principal(ctx, true); AccountId.parse(subjectId);
    this.atomic(() => { this.put("security", ctx.ownerId, subjectId, { rejectedAt: [], locked: false });
      this.append(ctx, null, "payment_authority_unlocked", { subjectId }); });
  }
  registerAccount(ctx: Principal, input: unknown): void {
    this.principal(ctx, true); const account = TransferAccount.parse(input);
    this.atomic(() => { this.put("account", ctx.ownerId, account.id, account);
      this.append(ctx, null, "account_registered", { accountId: account.id, address: account.address }); });
  }
  approveRecipient(ctx: Principal, input: unknown): void {
    this.principal(ctx, true); const recipient = TransferRecipient.parse(input);
    this.atomic(() => {
      if (recipient.kind === "internal" && !this.get("account", ctx.ownerId, recipient.accountId))
        throw new PaymentError("ACCOUNT_NOT_APPROVED");
      this.put("recipient", ctx.ownerId, recipient.id, recipient);
      this.append(ctx, null, "recipient_approved", { recipientId: recipient.id, channel: "owner_approved" });
    });
  }
  setPolicy(ctx: Principal, input: unknown): void {
    this.principal(ctx, true); const rules = TransferPolicy.parse(input);
    this.atomic(() => {
      const old = this.get<Policy>("policy", ctx.ownerId, "active");
      this.put("policy", ctx.ownerId, "active", { version: (old?.version ?? 0) + 1, rules,
        spent: old?.spent ?? "0.00", reserved: old?.reserved ?? "0.00" });
      this.append(ctx, null, "policy_changed", { enabled: String(rules.enabled), policyDigest:
        createHash("sha256").update(canonicalJson(rules)).digest("hex") });
    });
  }
  /** Only a trusted owner/backend may turn interpreted language into an authorized immutable intent. */
  createIntent(ctx: Principal, input: unknown): TransferResult {
    this.principal(ctx, true); const parsed = TransferIntentInput.parse(input);
    const data = { ...parsed, amount: fromCents(toCents(parsed.amount)) };
    const now = this.now().getTime(), expiry = Date.parse(data.expiresAt);
    if (expiry <= now || (data.executeAt !== null && Date.parse(data.executeAt) >= expiry))
      throw new PaymentError("INTENT_EXPIRED");
    return this.atomic(() => {
      const found = this.db.prepare("SELECT body FROM intents WHERE owner=? AND reference=?")
        .get(ctx.ownerId, data.reference);
      if (found) {
        const old = JSON.parse(found.body as string) as Intent;
        if (canonicalJson(this.inputOf(old)) !== canonicalJson(data)) throw new PaymentError("INTENT_MISMATCH");
        return this.publicResult(old);
      }
      const id = randomUUID();
      // Pin trusted account/recipient versions at authorization time. Subsequent edits must never
      // redirect an already approved intent to a different wallet.
      const binding = this.resolve(ctx, data);
      const intent: Intent = { ...data, amount: fromCents(toCents(data.amount)), id, ownerId: ctx.ownerId,
        reserved: false, result: { intentId: id, status: "created", code: "OK" } };
      this.put("binding", ctx.ownerId, id, binding);
      this.db.prepare("INSERT INTO intents VALUES(?,?,?,?,?)")
        .run(id, ctx.ownerId, data.sourceAccountId, data.reference, canonicalJson(intent));
      this.append(ctx, id, "intent_created", { amount: intent.amount, recipientId: data.recipientId,
        sourceAccountId: data.sourceAccountId, reference: data.reference, sourceAddress: binding.sourceAddress,
        destination: binding.destination, recipientKind: binding.recipientKind,
        ...(binding.destinationTag === undefined ? {} : { destinationTag: String(binding.destinationTag) }),
        expiresAt: data.expiresAt, ...(data.executeAt === null ? {} : { executeAt: data.executeAt }),
        currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, network: XRPL_TESTNET_WSS, bindingDigest:
          createHash("sha256").update(canonicalJson(binding)).digest("hex") });
      return this.publicResult(intent);
    });
  }
  private inputOf(intent: Intent): TransferIntentInput {
    const { sourceAccountId, recipientId, amount, reference, executeAt, expiresAt } = intent;
    return { sourceAccountId, recipientId, amount, reference, executeAt, expiresAt };
  }
  private resolve(ctx: Principal, input: TransferIntentInput): { sourceAddress: string; recipientKind: "internal" | "person" | "vendor"; destination: string; destinationTag?: number } {
    const source = this.get<{ address: string }>("account", ctx.ownerId, input.sourceAccountId);
    if (!source) throw new PaymentError("ACCOUNT_NOT_APPROVED");
    const recipient = this.get<TransferRecipient>("recipient", ctx.ownerId, input.recipientId);
    if (!recipient) throw new PaymentError("RECIPIENT_NOT_APPROVED");
    if (recipient.kind === "internal") {
      const account = this.get<{ address: string }>("account", ctx.ownerId, recipient.accountId);
      if (!account) throw new PaymentError("ACCOUNT_NOT_APPROVED");
      return { sourceAddress: source.address, recipientKind: recipient.kind, destination: account.address };
    }
    return { sourceAddress: source.address, recipientKind: recipient.kind, destination: recipient.address,
      ...(recipient.destinationTag === undefined ? {} : { destinationTag: recipient.destinationTag }) };
  }
  private publicResult(intent: Intent): TransferResult {
    return TransferResult.parse(intent.result);
  }
  getStatus(ctx: Principal, id: string): TransferResult {
    this.principal(ctx); PayToolRequest.parse({ intentId: id });
    return this.publicResult(this.intent(ctx, id));
  }
  private block(ctx: Principal, intent: Intent, code: TransferCode): TransferResult {
    this.release(intent, false);
    intent.result = { intentId: intent.id, status: "blocked", code }; this.save(intent);
    this.reject(ctx, code, intent.id); return this.publicResult(intent);
  }
  private release(intent: Intent, settled: boolean): void {
    if (!intent.reserved) return;
    const policy = this.get<Policy>("policy", intent.ownerId, "active");
    if (!policy) throw new PaymentError("POLICY_UNAVAILABLE");
    policy.reserved = fromCents(toCents(policy.reserved) - toCents(intent.amount));
    if (settled) policy.spent = fromCents(toCents(policy.spent) + toCents(intent.amount));
    this.put("policy", intent.ownerId, "active", policy); intent.reserved = false;
  }
  async pay(ctx: Principal, input: unknown): Promise<TransferResult> {
    this.principal(ctx);
    const parsed = PayToolRequest.safeParse(input);
    if (!parsed.success) { this.atomic(() => this.reject(ctx, "INVALID_REQUEST")); throw new PaymentError("INVALID_REQUEST"); }
    const id = parsed.data.intentId;
    const prepared = this.atomic((): PreparedTransfer | TransferResult => {
      if (!verifyTransferAudit(this.auditRows(ctx.ownerId))) throw new PaymentError("AUDIT_UNAVAILABLE");
      if (this.security(ctx).locked) throw new PaymentError("AUTHORITY_LOCKED");
      let intent: Intent;
      try { intent = this.intent(ctx, id); }
      catch { this.reject(ctx, "NOT_AUTHORIZED"); return { intentId: id, status: "blocked", code: "NOT_AUTHORIZED" }; }
      // Durable state prevents a second execution even across processes/restarts.
      if (!["created", "scheduled"].includes(intent.result.status)) return this.publicResult(intent);
      this.append(ctx, id, "payment_requested", {});
      if (Date.parse(intent.expiresAt) <= this.now().getTime()) return this.block(ctx, intent, "INTENT_EXPIRED");
      const policy = this.get<Policy>("policy", ctx.ownerId, "active");
      if (!policy) return this.block(ctx, intent, "POLICY_UNAVAILABLE");
      if (!policy.rules.enabled) return this.block(ctx, intent, "KILL_SWITCH_ON");
      const binding = this.resolve(ctx, intent);
      if (canonicalJson(binding) !== canonicalJson(this.get("binding", ctx.ownerId, id)))
        return this.block(ctx, intent, "INTENT_MISMATCH");
      if (intent.executeAt !== null && Date.parse(intent.executeAt) > this.now().getTime()) {
        intent.result = { intentId: id, status: "scheduled", code: "OK" }; this.save(intent);
        this.append(ctx, id, "payment_scheduled", { executeAt: intent.executeAt }); return this.publicResult(intent);
      }
      const cap = Object.hasOwn(policy.rules.recipientCaps, intent.recipientId) ?
        policy.rules.recipientCaps[intent.recipientId]! : policy.rules.perPaymentCap;
      if (toCents(intent.amount) > toCents(cap)) return this.block(ctx, intent, "OVER_PER_PAYMENT_CAP");
      if (toCents(policy.spent) + toCents(policy.reserved) + toCents(intent.amount) > toCents(policy.rules.totalBudget))
        return this.block(ctx, intent, "OVER_BUDGET");
      policy.reserved = fromCents(toCents(policy.reserved) + toCents(intent.amount));
      this.put("policy", ctx.ownerId, "active", policy);
      const auditHash = this.append(ctx, id, "budget_reserved", { amount: intent.amount, policyVersion: String(policy.version) });
      const payment: PreparedTransfer = { intentId: id, ownerId: ctx.ownerId,
        sourceAccountId: intent.sourceAccountId, recipientId: intent.recipientId, ...binding,
        amount: intent.amount, reference: intent.reference, network: XRPL_TESTNET_WSS,
        currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, policyVersion: policy.version, auditHash };
      intent.reserved = true; intent.policyVersion = policy.version; intent.prepared = payment;
      // Unknown until evidence proves an outcome; process death never re-enables submit.
      intent.result = { intentId: id, status: "unknown", code: "EXECUTION_UNKNOWN" }; this.save(intent);
      return Object.freeze(payment);
    });
    if (!("auditHash" in prepared)) return prepared;
    const digest = paymentDigest(prepared);
    let permit: ReturnType<typeof TransferPermit.parse>;
    try { permit = TransferPermit.parse(await this.adapters.policy.authorize(prepared, digest)); }
    catch { return this.atomic(() => this.block(ctx, this.intent(ctx, id), "POLICY_UNAVAILABLE")); }
    if (permit.decision !== "allow") {
      const code = permit.code;
      return this.atomic(() => this.block(ctx, this.intent(ctx, id), code));
    }
    if (permit.paymentDigest !== digest)
      return this.atomic(() => this.block(ctx, this.intent(ctx, id), "POLICY_DENIED"));
    const blocked = this.atomic((): TransferResult | null => {
      const intent = this.intent(ctx, id), policy = this.get<Policy>("policy", ctx.ownerId, "active");
      if (intent.result.status !== "unknown" || intent.submissionStarted) return this.publicResult(intent);
      if (this.security(ctx).locked) return this.block(ctx, intent, "AUTHORITY_LOCKED");
      if (Date.parse(intent.expiresAt) <= this.now().getTime()) return this.block(ctx, intent, "INTENT_EXPIRED");
      if (!policy?.rules.enabled) return this.block(ctx, intent, "KILL_SWITCH_ON");
      if (policy.version !== prepared.policyVersion) return this.block(ctx, intent, "POLICY_CHANGED");
      if (canonicalJson(this.resolve(ctx, intent)) !== canonicalJson(this.get("binding", ctx.ownerId, id)))
        return this.block(ctx, intent, "INTENT_MISMATCH");
      this.append(ctx, id, "policy_allowed", { paymentDigest: digest });
      this.append(ctx, id, "submission_started", { paymentDigest: digest });
      intent.submissionStarted = true; this.save(intent); return null;
    });
    if (blocked) return blocked;
    let receipt: unknown;
    try { receipt = await this.adapters.wallet.submit(prepared, { paymentDigest: digest, authorization: permit.authorization }); }
    catch { receipt = { status: "unknown", paymentDigest: digest }; }
    return this.recordReceipt(ctx, id, digest, receipt);
  }
  private recordReceipt(ctx: Principal, id: string, digest: string, raw: unknown): TransferResult {
    const parsed = TransferReceipt.safeParse(raw);
    const receipt = parsed.success && parsed.data.paymentDigest === digest ? parsed.data :
      { status: "unknown" as const, paymentDigest: digest };
    return this.atomic(() => {
      const intent = this.intent(ctx, id);
      if (["settled", "rejected", "blocked"].includes(intent.result.status)) return this.publicResult(intent);
      if (intent.result.txHash && "txHash" in receipt && receipt.txHash !== intent.result.txHash) {
        this.append(ctx, id, "receipt_rejected", { code: "INTENT_MISMATCH" });
        return this.publicResult(intent);
      }
      if (receipt.status === "settled" || receipt.status === "rejected") this.release(intent, receipt.status === "settled");
      intent.result = { intentId: id, status: receipt.status,
        code: receipt.status === "unknown" ? "EXECUTION_UNKNOWN" : receipt.status === "rejected" ? "LEDGER_REJECTED" : "OK",
        ...("txHash" in receipt ? { txHash: receipt.txHash } : intent.result.txHash ? { txHash: intent.result.txHash } : {}) };
      this.save(intent);
      this.append(ctx, id, "payment_" + receipt.status, { paymentDigest: digest,
        ...("txHash" in receipt ? { txHash: receipt.txHash } : {}),
        ...("ledgerIndex" in receipt ? { ledgerIndex: String(receipt.ledgerIndex), ledgerResult: receipt.ledgerResult } : {}) });
      return this.publicResult(intent);
    });
  }
  async reconcile(ctx: Principal, id: string): Promise<TransferResult> {
    this.principal(ctx); PayToolRequest.parse({ intentId: id }); const intent = this.intent(ctx, id);
    if (!["submitted", "unknown"].includes(intent.result.status) || !intent.prepared || !intent.submissionStarted)
      return this.publicResult(intent);
    const digest = paymentDigest(intent.prepared);
    this.atomic(() => this.append(ctx, id, "reconciliation_requested", { paymentDigest: digest }));
    let receipt: unknown;
    try { receipt = await this.adapters.wallet.lookup(Object.freeze(intent.prepared), digest, intent.result.txHash); }
    catch { receipt = { status: "unknown", paymentDigest: digest }; }
    return this.recordReceipt(ctx, id, digest, receipt);
  }
  /** Host timer/cron calls this with its own scoped credential. Schedules never bypass current policy. */
  async executeDue(ctx: Principal): Promise<TransferResult[]> {
    this.principal(ctx);
    const rows = this.db.prepare("SELECT id,body FROM intents WHERE owner=?").all(ctx.ownerId);
    const due = rows.filter(row => { const intent = JSON.parse(row.body as string) as Intent;
      return intent.result.status === "scheduled" && intent.executeAt !== null && Date.parse(intent.executeAt) <= this.now().getTime(); });
    const results: TransferResult[] = [];
    for (const row of due.slice(0, 100)) results.push(await this.pay(ctx, { intentId: row.id }));
    return results;
  }
  audit(ctx: Principal): AuditRecord[] {
    this.principal(ctx, true);
    return this.auditRows(ctx.ownerId);
  }
  private auditRows(ownerId: string): AuditRecord[] {
    return this.db.prepare("SELECT body FROM audit WHERE owner=? ORDER BY seq").all(ownerId)
      .map(row => JSON.parse(row.body as string) as AuditRecord);
  }
  budget(ctx: Principal): { spent: string; reserved: string } {
    this.principal(ctx, true); const p = this.get<Policy>("policy", ctx.ownerId, "active");
    if (!p) throw new PaymentError("POLICY_UNAVAILABLE"); return { spent: p.spent, reserved: p.reserved };
  }
}

/** Detects edits, gaps and reordering. Suffix deletion requires an independently retained checkpoint. */
export function verifyTransferAudit(entries: readonly AuditRecord[]): boolean {
  let previous = GENESIS_HASH, seq = 1;
  for (const { hash, ...entry } of entries) {
    if (entry.seq !== seq++ || entry.prevHash !== previous || auditDigest(entry) !== hash) return false;
    previous = hash;
  }
  return true;
}
