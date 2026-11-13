import { z } from "zod";
import { Amount } from "./money";
import { InvoiceNumber, Reason, SupplierId, SupplierName, XrplAddress } from "./ids";

/** A proposal to add the supplier named on an invoice. The owner decides; the address is checksummed. */
export const SupplierApprovalPayload = z.strictObject({
  name: SupplierName,
  address: XrplAddress.nullable(),
  evidence: Reason,
  invoiceNumber: InvoiceNumber,
});
export type SupplierApprovalPayload = z.infer<typeof SupplierApprovalPayload>;

/** A request for the owner to approve a payment over the cap or the remaining budget. */
export const PaymentApprovalPayload = z.strictObject({
  invoiceNumber: InvoiceNumber,
  supplierId: SupplierId,
  amount: Amount,
  reason: Reason,
});
export type PaymentApprovalPayload = z.infer<typeof PaymentApprovalPayload>;

/** POST /approvals body, discriminated on kind. Same {kind, payload} wire shape the agent sends today. */
export const ApprovalRequest = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("supplier"), payload: SupplierApprovalPayload }),
  z.strictObject({ kind: z.literal("payment"), payload: PaymentApprovalPayload }),
]);
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** POST /approvals answer. The agent only ever learns that an approval is pending. */
export const ApprovalResponse = z.strictObject({
  approvalId: z.string().min(1).max(64),
  status: z.literal("pending"),
});
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;
