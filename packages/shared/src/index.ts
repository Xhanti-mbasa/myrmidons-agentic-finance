import { z } from "zod";

/**
 * A positive USD/RLUSD amount as a decimal string: up to 12 integer digits, up to 2 decimals.
 * Strings only, so no float rounding and no "1e3"-style surprises reach the payment service.
 */
export const Amount = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, "amount must be a decimal string like \"30.00\"")
  .refine((value) => /[1-9]/.test(value), "amount must be greater than zero");
export type Amount = z.infer<typeof Amount>;

export const PayRequest = z.strictObject({
  supplierId: z.string().min(1),
  amount: Amount,
  invoiceNumber: z.string().min(1),
  reason: z.string().min(1),
});
export type PayRequest = z.infer<typeof PayRequest>;

export const RuleCode = z.enum([
  "OK",
  "KILL_SWITCH_ON",
  "SUPPLIER_NOT_APPROVED",
  "DESTINATION_MISMATCH",
  "WRONG_ASSET",
  "OVER_PER_PAYMENT_CAP",
  "OVER_BUDGET",
  "DUPLICATE_INVOICE",
  "FORBIDDEN_TX_FIELDS",
  "STALE_TX",
  "MEMO_MISMATCH",
  "RATE_LIMITED",
  "LEDGER_REJECTED",
]);
export type RuleCode = z.infer<typeof RuleCode>;

/** One fixed sentence per rule code, so explanations stay correct even when the model is weak. */
const EXPLANATIONS: Record<RuleCode, string> = {
  OK: "Paid: the invoice passed every rule the owner set.",
  KILL_SWITCH_ON: "Blocked: the owner has revoked the agent's payment authority.",
  SUPPLIER_NOT_APPROVED: "Blocked: this supplier is not on the owner's approved list.",
  DESTINATION_MISMATCH: "Blocked: the payment address does not match the supplier's approved address.",
  WRONG_ASSET: "Blocked: the payment is not in genuine test RLUSD.",
  OVER_PER_PAYMENT_CAP: "Blocked: the amount is above the owner's per-payment cap.",
  OVER_BUDGET: "Blocked: the payment would take spending past the owner's total budget.",
  DUPLICATE_INVOICE: "Blocked: this invoice has already been paid or is being paid.",
  FORBIDDEN_TX_FIELDS: "Blocked: the transaction used fields the policy does not allow.",
  STALE_TX: "Blocked: the transaction was too old or set to expire too late.",
  MEMO_MISMATCH: "Blocked: the transaction memo did not match its audit log entry.",
  RATE_LIMITED: "Blocked: too many payment requests in a short time.",
  LEDGER_REJECTED: "Failed: the XRP Ledger rejected the transaction.",
};

export function ruleExplanation(code: RuleCode): string {
  return EXPLANATIONS[code];
}

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
