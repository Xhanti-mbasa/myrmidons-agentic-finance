import { z } from "zod";
import { Amount, NonNegativeAmount } from "./money";
import { InvoiceNumber, XrplAddress } from "./ids";
import { Sha256Hex } from "./policy";

export const TransferId = z.uuid();
export const AccountId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const PayToolRequest = z.strictObject({ intentId: TransferId });
export type PayToolRequest = z.infer<typeof PayToolRequest>;
export const EmptyTransferBody = z.strictObject({});
export const UnlockTransferAuthority = z.strictObject({ subjectId: AccountId });
export const isTransferValidationError = (error: unknown): boolean => error instanceof z.ZodError;

/** Owner/backend input, NOT an agent tool. Identity and authorization come from the authenticated host. */
export const TransferIntentInput = z.strictObject({
  sourceAccountId: AccountId,
  recipientId: AccountId,
  amount: Amount,
  reference: InvoiceNumber,
  executeAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
});
export type TransferIntentInput = z.infer<typeof TransferIntentInput>;

export const TransferAccount = z.strictObject({ id: AccountId, address: XrplAddress });
export const TransferRecipient = z.discriminatedUnion("kind", [
  z.strictObject({ id: AccountId, kind: z.literal("internal"), accountId: AccountId }),
  z.strictObject({ id: AccountId, kind: z.enum(["person", "vendor"]), address: XrplAddress,
    destinationTag: z.int().min(0).max(4294967295).optional() }),
]);
export type TransferRecipient = z.infer<typeof TransferRecipient>;

/** A recipient cap overrides the global per-payment cap; total budget always applies. */
export const TransferPolicy = z.strictObject({
  enabled: z.boolean(), perPaymentCap: Amount, totalBudget: Amount,
  recipientCaps: z.record(AccountId, Amount),
});
export type TransferPolicy = z.infer<typeof TransferPolicy>;
export const TransferBudget = z.strictObject({ spent: NonNegativeAmount, reserved: NonNegativeAmount });

export const TransferCode = z.enum([
  "OK", "INVALID_REQUEST", "NOT_AUTHORIZED", "AUTHORITY_LOCKED", "INTENT_MISMATCH",
  "INTENT_EXPIRED", "ACCOUNT_NOT_APPROVED", "RECIPIENT_NOT_APPROVED", "KILL_SWITCH_ON",
  "OVER_PER_PAYMENT_CAP", "OVER_BUDGET", "POLICY_CHANGED", "POLICY_DENIED",
  "POLICY_UNAVAILABLE", "AUDIT_UNAVAILABLE", "EXECUTION_UNKNOWN", "LEDGER_REJECTED",
]);
export type TransferCode = z.infer<typeof TransferCode>;
export const TransferResult = z.strictObject({
  intentId: TransferId,
  status: z.enum(["created", "scheduled", "blocked", "submitted", "unknown", "settled", "rejected"]),
  code: TransferCode,
  txHash: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
}).superRefine((value, ctx) => {
  const ok = ["created", "scheduled", "submitted", "settled"].includes(value.status);
  if ((ok && value.code !== "OK") || (value.status === "blocked" && value.code === "OK") ||
      (value.status === "unknown" && value.code !== "EXECUTION_UNKNOWN") ||
      (value.status === "rejected" && value.code !== "LEDGER_REJECTED"))
    ctx.addIssue({ code: "custom", message: "status and code disagree" });
  if (["submitted", "settled", "rejected"].includes(value.status) && !value.txHash)
    ctx.addIssue({ code: "custom", message: "ledger outcome needs a transaction hash" });
  if (["created", "scheduled", "blocked"].includes(value.status) && value.txHash)
    ctx.addIssue({ code: "custom", message: "unsubmitted outcome cannot contain a transaction hash" });
});
export type TransferResult = z.infer<typeof TransferResult>;

/** Trusted policy adapter must bind its permit to this exact prepared-payment digest. */
export const TransferPermit = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("allow"), paymentDigest: Sha256Hex, authorization: z.string().min(1).max(8192) }),
  z.strictObject({ decision: z.literal("block"), code: TransferCode.exclude(["OK"]) }),
]);

/** Ledger adapter verifies the actual validated transaction, not just a submit response. */
export const TransferReceipt = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("settled"), paymentDigest: Sha256Hex,
    txHash: z.string().regex(/^[A-Fa-f0-9]{64}$/), validated: z.literal(true),
    ledgerIndex: z.int().positive(), ledgerResult: z.literal("tesSUCCESS") }),
  z.strictObject({ status: z.literal("rejected"), paymentDigest: Sha256Hex,
    txHash: z.string().regex(/^[A-Fa-f0-9]{64}$/), validated: z.literal(true),
    ledgerIndex: z.int().positive(), ledgerResult: z.string().regex(/^tec[A-Za-z0-9_]+$/) }),
  z.strictObject({ status: z.literal("submitted"), paymentDigest: Sha256Hex,
    txHash: z.string().regex(/^[A-Fa-f0-9]{64}$/) }),
  z.strictObject({ status: z.literal("unknown"), paymentDigest: Sha256Hex }),
]);
