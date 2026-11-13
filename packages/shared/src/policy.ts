import { z } from "zod";
import { Amount } from "./money";
import { InvoiceNumber, SupplierId } from "./ids";

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

/** SHA-256 as 64 lower-case hex characters: audit log hashes and the memo's log entry hash. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lower-case hex characters");

/** A signed transaction blob in hex (either case), whole bytes, at most 4 KB. */
export const HexBlob = z
  .string()
  .min(2)
  .max(8192)
  .regex(/^[0-9A-Fa-f]+$/, "expected hex")
  .refine((value) => value.length % 2 === 0, "expected whole bytes of hex");

/**
 * POST /cosign body (payment service to policy service). The policy service decodes agentSignedBlob
 * itself and checks it against txJson and request; nothing here is trusted as a description of the tx.
 */
export const CosignRequest = z.strictObject({
  txJson: z.record(z.string(), z.unknown()),
  agentSignedBlob: HexBlob,
  request: z.strictObject({
    supplierId: SupplierId,
    amount: Amount,
    invoiceNumber: InvoiceNumber,
    logEntryHash: Sha256Hex,
  }),
});
export type CosignRequest = z.infer<typeof CosignRequest>;

/**
 * POST /cosign answer. allow always has ruleCode OK and a policySignedBlob; block always has a non-OK
 * code and no blob key at all. A discriminated union, so callers get the narrowing for free.
 */
export const CosignResponse = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("allow"),
    ruleCode: z.literal("OK"),
    reason: z.string().min(1).max(500),
    policySignedBlob: HexBlob,
  }),
  z.strictObject({
    decision: z.literal("block"),
    ruleCode: RuleCode.exclude(["OK"]),
    reason: z.string().min(1).max(500),
  }),
]);
export type CosignResponse = z.infer<typeof CosignResponse>;
