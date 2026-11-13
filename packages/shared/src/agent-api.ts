import { z } from "zod";
import { Amount, NonNegativeAmount } from "./money";
import { InvoiceNumber, Reason, SupplierId, SupplierName } from "./ids";
import { RuleCode } from "./policy";

/** pay tool input and POST /payments body. Strict: no destination or address can ride along. */
export const PayRequest = z.strictObject({
  supplierId: SupplierId,
  amount: Amount,
  invoiceNumber: InvoiceNumber,
  reason: Reason,
});
export type PayRequest = z.infer<typeof PayRequest>;

export const PayResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("settled"), ruleCode: z.literal("OK"), txHash: z.string().min(1), logId: z.string() }),
  z.object({ status: z.literal("blocked"), ruleCode: RuleCode.exclude(["OK"]), txHash: z.string().optional(), logId: z.string() }),
  z.object({ status: z.literal("pending_approval"), ruleCode: RuleCode, approvalId: z.string().optional(), logId: z.string() }),
]);
export type PayResult = z.infer<typeof PayResult>;

/** Stage 1 output. The only shape of invoice data the planner is ever shown. */
export const ExtractedInvoice = z.object({
  supplierName: z.string().min(1),
  invoiceNumber: z.string().min(1),
  amount: Amount,
  currency: z.enum(["USD", "RLUSD"]),
  dueDate: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string(), amount: Amount })),
  payToAddressOnInvoice: z.string().nullable(),
  suspiciousText: z.array(z.string()),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoice>;

/** GET /rules. Strict at every level, so no supplier or treasury address can appear in it. */
export const Rules = z.strictObject({
  perPaymentCap: Amount,
  totalBudget: Amount,
  spent: NonNegativeAmount,
  reserved: NonNegativeAmount,
  remaining: NonNegativeAmount,
  periodStart: z.iso.date(),
  killSwitch: z.boolean(),
  suppliers: z.array(z.strictObject({ id: SupplierId, name: SupplierName })),
});
export type Rules = z.infer<typeof Rules>;

/** GET /suppliers?q= answer. Strict, so an address field makes it invalid. */
export const SupplierLookup = z.union([
  z.strictObject({ supplierId: SupplierId, name: SupplierName, confidence: z.number().min(0).max(1) }),
  z.strictObject({ notFound: z.literal(true) }),
]);
export type SupplierLookup = z.infer<typeof SupplierLookup>;

const IsoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime()]);

/** GET /log query. Every field optional; unknown filters are refused. */
export const LogFilter = z.strictObject({
  supplierId: SupplierId.optional(),
  from: IsoDateOrDateTime.optional(),
  to: IsoDateOrDateTime.optional(),
  status: z.enum(["settled", "blocked", "pending_approval"]).optional(),
});
export type LogFilter = z.infer<typeof LogFilter>;

export const AgentDecision = z.enum(["paid", "blocked", "awaiting_owner", "needs_review"]);
export type AgentDecision = z.infer<typeof AgentDecision>;

/**
 * What the agent reports for one invoice. "paid" exactly when ruleCode is OK, and a block always
 * names its rule, so the dashboard can never show "paid" for a payment the rules refused.
 */
export const AgentExplanation = z
  .strictObject({
    decision: AgentDecision,
    ruleCode: RuleCode.nullable(),
    explanation: z.string().min(1).max(1000),
    invoiceNumber: InvoiceNumber.nullable(),
  })
  .refine((e) => (e.decision === "paid") === (e.ruleCode === "OK"), "decision is paid exactly when ruleCode is OK")
  .refine((e) => e.decision !== "blocked" || e.ruleCode !== null, "a blocked decision names its rule code");
export type AgentExplanation = z.infer<typeof AgentExplanation>;
