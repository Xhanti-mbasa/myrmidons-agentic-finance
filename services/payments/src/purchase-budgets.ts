import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AccountId, PurchaseBudgetPolicy, PurchaseBudgetRequest, TrustedPurchaseQuote,
  canonicalJson, toMicros, fromMicros } from "../../../packages/shared/src/index";
import type { PurchaseReservation } from "../../../packages/shared/src/index";
import type { Principal } from "./payment";

export type PurchaseBudgetAdapters = {
  quotes: { resolve(id: string): unknown };
  /** Must independently verify exact payment identity and ledger outcome; no model-supplied status. */
  outcomes: { verify(reservation: Readonly<PurchaseReservation>, evidence: unknown): "settled" | "rejected" | "unknown";
    verifyAbsent?(ownerId:string,purchaseId:string,evidence:unknown):boolean;
    rejectedFeeRlusd?(reservation:Readonly<PurchaseReservation>,evidence:unknown):string };
};
export class PurchaseBudgetError extends Error {}
const fail = (code: string): never => { throw new PurchaseBudgetError(code); };
/** Monday 00:00 Africa/Johannesburg (UTC+02:00, no daylight saving). */
export function purchaseWeekStart(now: Date): string {
  const local = new Date(now.getTime() + 7_200_000);
  const day = local.getUTCDay();
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (day + 6) % 7) - 7_200_000).toISOString();
}
export function purchasePeriodStart(now: Date, period: "daily" | "weekly" | "monthly"): string {
  const local = new Date(now.getTime() + 7_200_000);
  if (period === "weekly") return purchaseWeekStart(now);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), period === "monthly" ? 1 : local.getUTCDate()) - 7_200_000).toISOString();
}
/** Independent private datastore; do not mount in the agent environment. No signing authority. */
export class PurchaseBudgetService {
  private db: DatabaseSync;
  constructor(path: string, private adapters: PurchaseBudgetAdapters, private now: () => Date = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS purchase_policy(owner TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_reservations(owner TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id));`);
  }
  close(): void { this.db.close(); }
  private auth(ctx: Principal, ownerOnly = false): void {
    if (!ctx || !AccountId.safeParse(ctx.ownerId).success || !AccountId.safeParse(ctx.subjectId).success ||
      !["owner", "agent"].includes(ctx.role) || (ownerOnly && ctx.role !== "owner")) fail("NOT_AUTHORIZED");
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private policy(owner: string): {version: number; rules: PurchaseBudgetPolicy} {
    const row = this.db.prepare("SELECT version,body FROM purchase_policy WHERE owner=?").get(owner);
    if (!row) return fail("POLICY_UNAVAILABLE");
    return { version: Number(row.version), rules: PurchaseBudgetPolicy.parse(JSON.parse(row.body as string)) };
  }
  setPolicy(ctx: Principal, input: unknown): void {
    this.auth(ctx, true); const rules = PurchaseBudgetPolicy.parse(input);
    this.atomic(() => {
      const row = this.db.prepare("SELECT version FROM purchase_policy WHERE owner=?").get(ctx.ownerId);
      this.db.prepare("INSERT INTO purchase_policy VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,body=excluded.body")
        .run(ctx.ownerId, Number(row?.version ?? 0) + 1, canonicalJson(rules));
    });
  }
  private rows(owner: string): PurchaseReservation[] {
    return this.db.prepare("SELECT body FROM purchase_reservations WHERE owner=?").all(owner)
      .map(row => JSON.parse(row.body as string) as PurchaseReservation);
  }
  private get(owner: string, id: string): PurchaseReservation {
    const row = this.db.prepare("SELECT body FROM purchase_reservations WHERE owner=? AND id=?").get(owner,id);
    return row ? JSON.parse(row.body as string) as PurchaseReservation : fail("NOT_AUTHORIZED");
  }
  reservation(ctx: Principal, purchaseId: string): PurchaseReservation | undefined {
    this.auth(ctx);
    const row = this.db.prepare("SELECT body FROM purchase_reservations WHERE owner=? AND id=?").get(ctx.ownerId,purchaseId);
    return row ? JSON.parse(row.body as string) as PurchaseReservation : undefined;
  }
  private save(value: PurchaseReservation): void {
    this.db.prepare("INSERT INTO purchase_reservations VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body")
      .run(value.ownerId,value.purchaseId,canonicalJson(value));
  }
  private usage(owner: string, categoryId: string, periodType: "daily" | "weekly" | "monthly"): {spent: bigint; reserved: bigint} {
    let spent = 0n, reserved = 0n;
    const period = purchasePeriodStart(this.now(), periodType);
    for (const row of this.rows(owner).filter(row => row.categoryId === categoryId)) {
      // All unresolved reservations carry forward; old settled spend has no rollover.
      if (row.state === "reserved" || row.state === "unknown") reserved += toMicros(row.chargedZar);
      if ((row.state === "settled" || row.state==='rejected' && row.rejectedFeeRlusd) && (row.settledAt ? purchasePeriodStart(new Date(row.settledAt), periodType) === period : row.settledPeriodStart === period && row.settledPeriod === periodType)) spent += toMicros(row.chargedZar);
    }
    return {spent,reserved};
  }
  private aggregate(owner: string): bigint {
    return this.rows(owner).reduce((sum,row) => sum + (row.state==='rejected'
      ? toMicros(row.rejectedFeeRlusd??'0'):toMicros(row.amountRlusd)+toMicros(row.feeRlusd)),0n);
  }
  remaining(ctx: Principal, categoryId: string): {periodStart: string; spentZar: string; reservedZar: string; remainingZar: string} {
    this.auth(ctx); AccountId.parse(categoryId);
    return this.atomic(() => {
      const category = this.policy(ctx.ownerId).rules.categories[categoryId];
      if (!category) return fail("CATEGORY_NOT_APPROVED");
      const {spent,reserved} = this.usage(ctx.ownerId, categoryId, category.period);
      const available = toMicros(category.periodBudgetZar) - spent - reserved;
      return {periodStart: purchasePeriodStart(this.now(), category.period), spentZar: fromMicros(spent), reservedZar: fromMicros(reserved),
        remainingZar: fromMicros(available > 0n ? available : 0n)};
    });
  }
  reserve(ctx: Principal, input: unknown): PurchaseReservation {
    this.auth(ctx); const raw = PurchaseBudgetRequest.parse(input);
    const request = {...raw, amountRlusd: fromMicros(toMicros(raw.amountRlusd)), feeRlusd: fromMicros(toMicros(raw.feeRlusd))};
    return this.atomic(() => {
      const prior = this.rows(ctx.ownerId).find(row => row.purchaseId === request.purchaseId);
      if (prior) {
        const old = PurchaseBudgetRequest.parse(Object.fromEntries(Object.keys(request).map(key => [key, prior[key as keyof PurchaseReservation]])));
        if (canonicalJson(old) !== canonicalJson(request)) return fail("PURCHASE_MISMATCH");
        return prior;
      }
      const policy = this.policy(ctx.ownerId), category = policy.rules.categories[request.categoryId];
      if (!policy.rules.enabled) return fail("KILL_SWITCH_ON");
      if (!category) return fail("CATEGORY_NOT_APPROVED");
      if (!category.merchantIds.includes(request.merchantId)) return fail("MERCHANT_NOT_APPROVED");
      if (ctx.role !== "owner" && !category.autoPurchase) return fail("OWNER_APPROVAL_REQUIRED");
      const quote = TrustedPurchaseQuote.parse(this.adapters.quotes.resolve(request.quoteId));
      const time = this.now().getTime();
      if (quote.id !== request.quoteId || Date.parse(quote.issuedAt) > time || Date.parse(quote.expiresAt) <= time ||
        Date.parse(quote.expiresAt) <= Date.parse(quote.issuedAt)) return fail("QUOTE_UNAVAILABLE");
      // Charge maximum RLUSD resource price + declared RLUSD fees; round upward once to a ZAR micro-unit.
      const charged = ((toMicros(request.amountRlusd) + toMicros(request.feeRlusd)) * toMicros(quote.zarPerRlusd) + 999_999n) / 1_000_000n;
      if (charged > toMicros(category.perPurchaseZar)) return fail("OVER_PER_PURCHASE_CAP");
      const {spent,reserved} = this.usage(ctx.ownerId, request.categoryId, category.period);
      if (spent + reserved + charged > toMicros(category.periodBudgetZar)) return fail("OVER_PERIOD_BUDGET");
      if (policy.rules.aggregateRlusd) {
        const total = toMicros(request.amountRlusd) + toMicros(request.feeRlusd);
        if (total > toMicros(policy.rules.aggregateRlusd.perPurchase)) return fail('OVER_GLOBAL_PURCHASE_CAP');
        if (this.aggregate(ctx.ownerId) + total > toMicros(policy.rules.aggregateRlusd.lifetimeBudget)) return fail('OVER_GLOBAL_BUDGET');
      }
      const bound = {...request, ownerId: ctx.ownerId, policyVersion: policy.version,
        periodStart: purchasePeriodStart(this.now(), category.period), period: category.period, chargedZar: fromMicros(charged), quote};
      const reservation: PurchaseReservation = {...bound, budgetDigest: createHash("sha256").update(canonicalJson(bound)).digest("hex"),state: "reserved"};
      this.save(reservation); return reservation;
    });
  }
  /** Signer integration must call immediately before granting new authority, then mark unknown before submission. */
  authorize(ctx: Principal, purchaseId: string): PurchaseReservation {
    this.auth(ctx);
    return this.atomic(() => {
      const reservation = this.get(ctx.ownerId,purchaseId), policy = this.policy(ctx.ownerId);
      if (reservation.state !== "reserved") return fail("PURCHASE_ALREADY_EXECUTED");
      if (!policy.rules.enabled) return fail("KILL_SWITCH_ON");
      if (policy.version !== reservation.policyVersion) return fail("POLICY_CHANGED");
      if (Date.parse(reservation.quote.expiresAt) <= this.now().getTime()) return fail("QUOTE_UNAVAILABLE");
      reservation.state = "unknown"; this.save(reservation); return reservation;
    });
  }
  /** Private signer boundary: serialize final current-policy validation and synchronous signing
   * against owner edits on this database. Never await or perform network I/O in the callback. */
  withSigningAuthority<T>(ctx: Principal, purchaseId: string, budgetDigest: string,
    sign: (reservation: Readonly<PurchaseReservation>) => T): T {
    this.auth(ctx);
    return this.atomic(() => {
      const reservation = this.get(ctx.ownerId,purchaseId), policy = this.policy(ctx.ownerId);
      if (reservation.state !== 'unknown' || reservation.budgetDigest !== budgetDigest) return fail('PURCHASE_MISMATCH');
      if (!policy.rules.enabled) return fail('KILL_SWITCH_ON');
      if (policy.version !== reservation.policyVersion) return fail('POLICY_CHANGED');
      if (Date.parse(reservation.quote.expiresAt) <= this.now().getTime()) return fail('QUOTE_UNAVAILABLE');
      if (!policy.rules.aggregateRlusd) return fail('GLOBAL_MANDATE_REQUIRED');
      if (this.aggregate(ctx.ownerId) > toMicros(policy.rules.aggregateRlusd.lifetimeBudget)) return fail('OVER_GLOBAL_BUDGET');
      const category = policy.rules.categories[reservation.categoryId];
      if (!category || !category.merchantIds.includes(reservation.merchantId)) return fail('MERCHANT_NOT_APPROVED');
      const {spent,reserved} = this.usage(ctx.ownerId,reservation.categoryId,category.period);
      if (spent + reserved > toMicros(category.periodBudgetZar)) return fail('OVER_PERIOD_BUDGET');
      const result = sign(Object.freeze(structuredClone(reservation)));
      if (result && typeof (result as any).then === 'function') return fail('ASYNC_SIGNING_FORBIDDEN');
      return result;
    });
  }
  recordOutcome(ctx: Principal, purchaseId: string, evidence: unknown): PurchaseReservation {
    this.auth(ctx);
    return this.atomic(() => {
      const reservation = this.get(ctx.ownerId,purchaseId);
      if (reservation.state === "settled" || reservation.state === "rejected") return reservation;
      const outcome = this.adapters.outcomes.verify(structuredClone(reservation),evidence);
      if (!["settled","rejected","unknown"].includes(outcome)) return fail("OUTCOME_UNAVAILABLE");
      if (reservation.state !== "unknown" && outcome === "settled") return fail("PURCHASE_NOT_AUTHORIZED");
      if(outcome==='rejected') {
        // A validated tec rejection still burns XRP. Keep its conservative converted fee
        // charged; only independently proven no-sign outcomes can have zero fee.
        const fee=this.adapters.outcomes.rejectedFeeRlusd?.(structuredClone(reservation),evidence)??reservation.feeRlusd;
        if(toMicros(fee)>toMicros(reservation.feeRlusd))return fail('FEE_ALLOWANCE_EXCEEDED');
        reservation.rejectedFeeRlusd=fromMicros(toMicros(fee));
        reservation.chargedZar=fromMicros((toMicros(fee)*toMicros(reservation.quote.zarPerRlusd)+999_999n)/1_000_000n);
        reservation.settledAt=this.now().toISOString();
      }
      if (outcome === "settled") { const category = this.policy(ctx.ownerId).rules.categories[reservation.categoryId]; if (!category) return fail("CATEGORY_NOT_APPROVED"); reservation.settledAt = this.now().toISOString(); reservation.settledPeriod = category.period; reservation.settledPeriodStart = purchasePeriodStart(this.now(), category.period); }
      reservation.state = outcome; this.save(reservation); return reservation;
    });
  }
  /** Used only for a durable purchase whose budget reservation never committed. */
  reconcileAbsent(ctx: Principal,purchaseId:string,evidence:unknown): 'unknown'|'rejected' {
    this.auth(ctx);
    return !this.reservation(ctx,purchaseId) && this.adapters.outcomes.verifyAbsent?.(ctx.ownerId,purchaseId,evidence)
      ? 'rejected':'unknown';
  }
}
