import { toHex, type LogEntry, type PayRequest, type PayResult } from "@shucamoxa/shared";

/** How payments that pass the backend's checks are settled. */
export type SettlementMode = "mock" | "xrpl-testnet";

export type NewLogEntry = Omit<LogEntry, "seq" | "ts" | "prevHash" | "hash">;

/** An approved supplier as the settler sees it: the address comes from the owner's rules, never from the agent. */
export type SettledSupplier = { id: string; name: string; address: string; status: "approved" };

/** What the store lends a settler: its hash-chained log and its approved-supplier lookup. */
export type SettlerContext = {
  append(entry: NewLogEntry): Promise<LogEntry>;
  supplier(supplierId: string): SettledSupplier | null;
};

/**
 * Settles one payment that already passed the store's checks. Must log its own outcome through
 * ctx.append and return the matching PayResult. Throwing means the outcome is unknown: the store then
 * holds the amount and refuses to resubmit the invoice.
 */
export type Settler = {
  readonly mode: SettlementMode;
  settle(request: PayRequest): Promise<PayResult>;
};

export type SettlerFactory = (ctx: SettlerContext) => Settler;

export const MOCK_LEDGER_RESULT = "MOCK_NOT_SUBMITTED";

/**
 * A 64-hex "tx hash" that decodes to the text MOCK-TX-NOT-ON-LEDGER-<10 digits>. It fits LogEntry's
 * txHash format, so the log stays one shape, but any explorer lookup fails and fromHex shows it's fake.
 */
export function mockTxHash(n: number): string {
  return toHex(`MOCK-TX-NOT-ON-LEDGER-${String(n).padStart(10, "0")}`);
}

/** The default: nothing reaches any ledger. */
export const mockSettler: SettlerFactory = (ctx) => {
  let count = 0;
  return {
    mode: "mock",
    async settle(request) {
      const txHash = mockTxHash(++count);
      const entry = await ctx.append({
        actor: "payment",
        event: "payment_settled",
        invoiceNumber: request.invoiceNumber,
        supplierId: request.supplierId,
        amount: request.amount,
        ruleCode: "OK",
        explanation: `Paid: the invoice passed every rule the owner set. Agent's reason: ${request.reason}`,
        txHash,
        ledgerResult: MOCK_LEDGER_RESULT,
      });
      return { status: "settled", ruleCode: "OK", txHash, logId: String(entry.seq) };
    },
  };
};
