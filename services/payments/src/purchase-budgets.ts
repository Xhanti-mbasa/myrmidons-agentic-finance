import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AccountId, PurchaseBudgetPolicy, PurchaseBudgetRequest, TrustedPurchaseQuote,
  canonicalJson, toMicros, fromMicros } from "../../../packages/shared/src/index";
import type { PurchaseReservation } from "../../../packages/shared/src/index";
import type { Principal } from "./payment";

export type PurchaseBudgetAdapters = {
  quotes: { resolve(id: string): unknown };
  /** Must independently verify exact payment identity and ledger outcome; no model-supplied status. */
  outcomes: { verify(reservation: Readonly<PurchaseReservation>, evidence: unknown): "settled" | "rejected" | "unknown" };
};
export class PurchaseBudgetError extends Error {}
const fail = (code: string): never => { throw new PurchaseBudgetError(code); };
/** Monday 00:00 Africa/Johannesburg (UTC+02:00, no daylight saving). */
export function purchaseWeekStart(now: Date): string {
  const local = new Date(now.getTime() + 7_200_000);
  const day = local.getUTCDay();
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (day + 6) % 7) - 7_200_000).toISOString();
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
  private save(value: PurchaseReservation): void {
    this.db.prepare("INSERT INTO purchase_reservations VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body")
      .run(value.ownerId,value.purchaseId,canonicalJson(value));
  }
  private usage(owner: string, categoryId: string): {spent: bigint; reserved: bigint} {
    let spent = 0n, reserved = 0n;
    const period = purchaseWeekStart(this.now());
    for (const row of this.rows(owner).filter(row => row.categoryId === categoryId)) {
      // All unresolved reservations carry forward; old settled spend has no rollover.
      if (row.state === "reserved" || row.state === "unknown") reserved += toMicros(row.chargedZar);
      if (row.state === "settled" && row.settledPeriodStart === period) spent += toMicros(row.chargedZar);
    }
    return {spent,reserved};
  }
  remaining(ctx: Principal, categoryId: string): {periodStart: string; spentZar: string; reservedZar: string; remainingZar: string} {
    this.auth(ctx); AccountId.parse(categoryId);
    return this.atomic(() => {
      const category = this.policy(ctx.ownerId).rules.categories[categoryId];
      if (!category) return fail("CATEGORY_NOT_APPROVED");
      const {spent,reserved} = this.usage(ctx.ownerId, categoryId);
      const available = toMicros(category.weeklyZar) - spent - reserved;
      return {periodStart: purchaseWeekStart(this.now()), spentZar: fromMicros(spent), reservedZar: fromMicros(reserved),
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
      const {spent,reserved} = this.usage(ctx.ownerId, request.categoryId);
      if (spent + reserved + charged > toMicros(category.weeklyZar)) return fail("OVER_WEEKLY_BUDGET");
      const bound = {...request, ownerId: ctx.ownerId, policyVersion: policy.version,
        periodStart: purchaseWeekStart(this.now()), chargedZar: fromMicros(charged), quote};
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
  recordOutcome(ctx: Principal, purchaseId: string, evidence: unknown): PurchaseReservation {
    this.auth(ctx);
    return this.atomic(() => {
      const reservation = this.get(ctx.ownerId,purchaseId);
      if (reservation.state === "settled" || reservation.state === "rejected") return reservation;
      const outcome = this.adapters.outcomes.verify(structuredClone(reservation),evidence);
      if (!["settled","rejected","unknown"].includes(outcome)) return fail("OUTCOME_UNAVAILABLE");
      if (reservation.state !== "unknown" && outcome === "settled") return fail("PURCHASE_NOT_AUTHORIZED");
      if (outcome === "settled") reservation.settledPeriodStart = purchaseWeekStart(this.now());
      reservation.state = outcome; this.save(reservation); return reservation;
    });
  }
}
