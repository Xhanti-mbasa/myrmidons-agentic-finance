import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  fromCents,
  GENESIS_HASH,
  hashLogEntry,
  LogEntry,
  ruleExplanation,
  supplierNameConfidence,
  toCents,
  toHex,
  type ApprovalRequest,
  type ApprovalResponse,
  type LogFilter,
  type PayRequest,
  type PayResult,
  type RuleCode,
  type Rules,
  type SupplierLookup,
} from "@shucamoxa/shared";
import type { MockSeed } from "./seed";

/** Confidence reported when two suppliers tie for the best score: an ambiguous name is never payable. */
const AMBIGUOUS_CONFIDENCE_CAP = 0.5;
const LOG_PAGE_SIZE = 50;

/** What the mock writes as ledgerResult: it never submits anything, so it never claims tesSUCCESS. */
export const MOCK_LEDGER_RESULT = "MOCK_NOT_SUBMITTED";

/**
 * A 64-hex "tx hash" that decodes to the text MOCK-TX-NOT-ON-LEDGER-<10 digits>. It fits LogEntry's
 * txHash format, so the log stays one shape, but any explorer lookup fails and fromHex shows it's fake.
 */
export function mockTxHash(n: number): string {
  return toHex(`MOCK-TX-NOT-ON-LEDGER-${String(n).padStart(10, "0")}`);
}

type StoredPayment = { supplierId: string; cents: bigint; result: PayResult };
type NewEntry = Omit<LogEntry, "seq" | "ts" | "prevHash" | "hash">;

/**
 * The mock's whole state, in memory. Every write runs through one in-process queue, so the budget
 * check and the log append of one request finish before the next request's check starts.
 */
export class MockStore {
  private readonly capCents: bigint;
  private readonly budgetCents: bigint;
  private spentCents = 0n;
  private killSwitch: boolean;
  private readonly payments = new Map<string, StoredPayment>();
  private readonly log: LogEntry[] = [];
  private txCount = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly seed: MockSeed,
    private readonly approvalsFile: string,
  ) {
    this.capCents = toCents(seed.perPaymentCap);
    this.budgetCents = toCents(seed.totalBudget);
    this.killSwitch = seed.killSwitch;
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private approved() {
    return this.seed.suppliers.filter((s) => s.status === "approved");
  }

  rules(): Rules {
    const remaining = this.budgetCents - this.spentCents;
    return {
      perPaymentCap: fromCents(this.capCents),
      totalBudget: fromCents(this.budgetCents),
      spent: fromCents(this.spentCents),
      reserved: "0.00", // the mock settles instantly, so nothing is ever held in reserve
      remaining: fromCents(remaining > 0n ? remaining : 0n),
      periodStart: this.seed.periodStart,
      killSwitch: this.killSwitch,
      suppliers: this.approved().map((s) => ({ id: s.id, name: s.name })),
    };
  }

  findSupplier(query: string): SupplierLookup {
    const scored = this.approved()
      .map((s) => ({ s, score: supplierNameConfidence(query, s.name) }))
      .sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    if (!best || best.score === 0) return { notFound: true };
    const confidence = second && second.score === best.score ? Math.min(best.score, AMBIGUOUS_CONFIDENCE_CAP) : best.score;
    return { supplierId: best.s.id, name: best.s.name, confidence };
  }

  /**
   * Policy checks 1, 3, 7, 8 and 9 in the spec's order, in cents. Idempotent on invoiceNumber: an exact
   * repeat (same supplier and amount; the reason may differ) gets the stored result and no log entry.
   */
  pay(request: PayRequest): Promise<PayResult> {
    return this.serialise(async () => {
      const cents = toCents(request.amount);
      const prior = this.payments.get(request.invoiceNumber);
      if (prior && prior.supplierId === request.supplierId && prior.cents === cents) return prior.result;

      const code = this.check(request.supplierId, cents, prior);
      const base = {
        invoiceNumber: request.invoiceNumber,
        supplierId: request.supplierId,
        amount: fromCents(cents),
        ruleCode: code,
        explanation: `${ruleExplanation(code)} Agent's reason: ${request.reason}`,
      };

      let result: PayResult;
      if (code === "OK") {
        const txHash = mockTxHash(++this.txCount);
        const entry = await this.append({ ...base, actor: "payment", event: "payment_settled", txHash, ledgerResult: MOCK_LEDGER_RESULT });
        this.spentCents += cents;
        result = { status: "settled", ruleCode: "OK", txHash, logId: String(entry.seq) };
      } else {
        const entry = await this.append({ ...base, actor: "policy", event: "policy_blocked", txHash: null, ledgerResult: null });
        result = { status: "blocked", ruleCode: code, logId: String(entry.seq) };
      }
      // A settled invoice keeps its result for good; an unsettled one is re-checked if the request changes.
      if (prior?.result.status !== "settled") this.payments.set(request.invoiceNumber, { supplierId: request.supplierId, cents, result });
      return result;
    });
  }

  private check(supplierId: string, cents: bigint, prior: StoredPayment | undefined): RuleCode {
    if (this.killSwitch) return "KILL_SWITCH_ON";
    if (!this.approved().some((s) => s.id === supplierId)) return "SUPPLIER_NOT_APPROVED";
    if (cents > this.capCents) return "OVER_PER_PAYMENT_CAP";
    if (this.spentCents + cents > this.budgetCents) return "OVER_BUDGET";
    if (prior?.result.status === "settled") return "DUPLICATE_INVOICE";
    return "OK";
  }

  /** Appends to .mock/approvals.jsonl (owner-only file mode), then logs approval_requested. */
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    return this.serialise(async () => {
      const approvalId = `appr_${randomUUID()}`;
      const line = { approvalId, ts: new Date().toISOString(), status: "pending", kind: request.kind, payload: request.payload };
      await mkdir(dirname(this.approvalsFile), { recursive: true, mode: 0o700 });
      await appendFile(this.approvalsFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      const payment = request.kind === "payment" ? request.payload : null;
      await this.append({
        actor: "agent",
        event: "approval_requested",
        invoiceNumber: request.payload.invoiceNumber,
        supplierId: payment?.supplierId ?? null,
        amount: payment ? fromCents(toCents(payment.amount)) : null,
        ruleCode: null,
        // No name or address from the payload: those are invoice text, and the owner reads them in the queue.
        explanation: payment ? "Agent asked the owner to approve a payment outside its limits." : "Agent proposed a new supplier for the owner to review.",
        txHash: null,
        ledgerResult: null,
      });
      return { approvalId, status: "pending" };
    });
  }

  /** Owner-only (POST /dev/kill-switch). Logs only an actual change. */
  setKillSwitch(on: boolean): Promise<{ killSwitch: boolean }> {
    return this.serialise(async () => {
      if (on !== this.killSwitch) {
        this.killSwitch = on;
        await this.append({
          actor: "owner",
          event: on ? "kill_switch_on" : "kill_switch_off",
          invoiceNumber: null,
          supplierId: null,
          amount: null,
          ruleCode: null,
          explanation: on ? "Owner revoked the agent's payment authority (mock kill switch)." : "Owner restored the agent's payment authority (mock kill switch).",
          txHash: null,
          ledgerResult: null,
        });
      }
      return { killSwitch: this.killSwitch };
    });
  }

  /** Newest first, at most 50. A date-only `to` includes that whole UTC day. */
  queryLog(filter: LogFilter): LogEntry[] {
    const from = filter.from ? Date.parse(filter.from) : -Infinity;
    const to = filter.to ? (filter.to.length === 10 ? Date.parse(filter.to) + 86_400_000 - 1 : Date.parse(filter.to)) : Infinity;
    const event = filter.status && { settled: "payment_settled", blocked: "policy_blocked", pending_approval: "approval_requested" }[filter.status];
    return this.log
      .filter((e) => (filter.supplierId ? e.supplierId === filter.supplierId : true))
      .filter((e) => (event ? e.event === event : true))
      .filter((e) => {
        const ts = Date.parse(e.ts);
        return ts >= from && ts <= to;
      })
      .reverse()
      .slice(0, LOG_PAGE_SIZE);
  }

  /** Only called inside serialise, so seq and prevHash can't race. */
  private async append(fields: NewEntry): Promise<LogEntry> {
    const prev = this.log.at(-1);
    const unhashed = { ...fields, seq: (prev?.seq ?? 0) + 1, ts: new Date().toISOString(), prevHash: prev?.hash ?? GENESIS_HASH };
    const entry = LogEntry.parse({ ...unhashed, hash: await hashLogEntry(unhashed.prevHash, unhashed) });
    this.log.push(entry);
    return entry;
  }
}
