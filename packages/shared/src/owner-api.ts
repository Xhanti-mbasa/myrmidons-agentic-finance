import { z } from "zod";
import { Amount, NonNegativeAmount } from "./money";
import { InvoiceNumber, SupplierId, SupplierName } from "./ids";
import { RuleCode } from "./policy";
import { Actor, LogEvent } from "./log";
import { MAX_INVOICE_TEXT_CHARS } from "./agent-service";

/**
 * The owner dashboard API (M04), served by the demo backend under /owner/api. Owner session only:
 * never reachable with the agent token. Every body is strict, so nothing extra can ride along.
 */

/** POST /owner/login body. */
export const OwnerLoginBody = z.strictObject({ token: z.string().min(1).max(512) });
export type OwnerLoginBody = z.infer<typeof OwnerLoginBody>;

/** POST /owner/api/kill-switch body. */
export const OwnerKillSwitchBody = z.strictObject({ on: z.boolean() });
export type OwnerKillSwitchBody = z.infer<typeof OwnerKillSwitchBody>;

/** PUT /owner/api/limits body: both positive decimal strings. */
export const OwnerLimitsBody = z.strictObject({ perPaymentCap: Amount, totalBudget: Amount });
export type OwnerLimitsBody = z.infer<typeof OwnerLimitsBody>;

/** POST /owner/api/approvals/:id body. Records the decision only: it never pays or adds a supplier. */
export const OwnerApprovalDecisionBody = z.strictObject({ decision: z.enum(["approve", "reject"]) });
export type OwnerApprovalDecisionBody = z.infer<typeof OwnerApprovalDecisionBody>;

/** POST /owner/api/invoices body: the invoice text the backend forwards to the agent. */
export const OwnerInvoiceBody = z.strictObject({ text: z.string().min(1).max(MAX_INVOICE_TEXT_CHARS) });
export type OwnerInvoiceBody = z.infer<typeof OwnerInvoiceBody>;

/** A supplier address shortened for display ("rAbc12…WxYz"): never enough to pay. */
export const ShortAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/, "expected a shortened address like rAbc12…WxYz");
export type ShortAddress = z.infer<typeof ShortAddress>;

/** The only explorer links the dashboard renders: XRPL Testnet transaction pages. */
export const TestnetExplorerUrl = z.string().regex(/^https:\/\/testnet\.xrpl\.org\/transactions\/[0-9A-F]{64}$/, "expected a testnet.xrpl.org transaction link");
export type TestnetExplorerUrl = z.infer<typeof TestnetExplorerUrl>;

export const OwnerApproval = z.strictObject({
  approvalId: z.string().min(1).max(64),
  ts: z.iso.datetime(),
  kind: z.enum(["payment", "supplier"]),
  invoiceNumber: InvoiceNumber,
  supplierId: SupplierId.nullable(),
  /** The approved supplier's name for a payment; the name on the invoice for a supplier proposal. */
  supplierName: SupplierName.nullable(),
  shortAddress: ShortAddress.nullable(),
  amount: Amount.nullable(),
  /** The agent's reason or evidence. Untrusted invoice-derived text: render with textContent only. */
  reason: z.string().max(500),
});
export type OwnerApproval = z.infer<typeof OwnerApproval>;

export const OwnerActivityRow = z.strictObject({
  seq: z.int().positive(),
  ts: z.iso.datetime(),
  actor: Actor,
  event: LogEvent,
  invoiceNumber: InvoiceNumber.nullable(),
  supplierId: SupplierId.nullable(),
  supplierName: SupplierName.nullable(),
  amount: Amount.nullable(),
  ruleCode: RuleCode.nullable(),
  explanation: z.string().max(500),
  txHash: z.string().regex(/^[0-9A-Fa-f]{64}$/).nullable(),
  ledgerResult: z.string().regex(/^[A-Za-z0-9_]{1,64}$/).nullable(),
  /** Present only for a payment validated on XRPL Testnet; absent in mock mode. */
  explorerUrl: TestnetExplorerUrl.optional(),
});
export type OwnerActivityRow = z.infer<typeof OwnerActivityRow>;

/** GET /owner/api/state. */
export const OwnerState = z.strictObject({
  rules: z.strictObject({
    perPaymentCap: Amount,
    totalBudget: Amount,
    spent: NonNegativeAmount,
    reserved: NonNegativeAmount,
    remaining: NonNegativeAmount,
    periodStart: z.iso.date(),
  }),
  killSwitch: z.boolean(),
  suppliers: z.array(z.strictObject({ id: SupplierId, name: SupplierName, shortAddress: ShortAddress })),
  approvals: z.array(OwnerApproval),
  activity: z.array(OwnerActivityRow).max(50),
});
export type OwnerState = z.infer<typeof OwnerState>;

/** Shortens a classic address to its first six and last four characters. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The Testnet explorer page for a transaction hash (upper-cased, as the explorer writes it). */
export function testnetExplorerUrl(txHash: string): string {
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) throw new TypeError("testnetExplorerUrl: expected a 64-hex transaction hash");
  return `https://testnet.xrpl.org/transactions/${txHash.toUpperCase()}`;
}
