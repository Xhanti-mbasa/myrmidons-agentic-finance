import { z } from "zod";
import { InvoiceNumber } from "./ids";
import { RuleCode } from "./policy";
import { AgentDecision, AgentExplanation } from "./agent-api";

/** The agent HTTP service (T12): what the backend sends it and what it answers. */

/** Largest invoice text the agent accepts, in characters. */
export const MAX_INVOICE_TEXT_CHARS = 20_000;

/** The backend's ID for an uploaded invoice. Never a path: ASCII letters, digits, "_" and "-" only. */
export const AgentInvoiceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "invoice ID must be 1-64 ASCII letters, digits, _ or -");
export type AgentInvoiceId = z.infer<typeof AgentInvoiceId>;

/** POST /agent/invoices body. */
export const ProcessInvoiceRequest = z.strictObject({
  invoiceId: AgentInvoiceId,
  text: z.string().min(1).max(MAX_INVOICE_TEXT_CHARS),
});
export type ProcessInvoiceRequest = z.infer<typeof ProcessInvoiceRequest>;

export const AgentFlag = z.enum(["ADDRESS_ON_INVOICE_IGNORED", "SUSPICIOUS_TEXT"]);
export type AgentFlag = z.infer<typeof AgentFlag>;

/** The full outcome of one invoice run. Strict, so no address or model output can ride along. */
export const InvoiceOutcome = z
  .strictObject({
    invoiceNumber: InvoiceNumber.nullable(),
    decision: AgentDecision,
    ruleCode: RuleCode.nullable(),
    explanation: z.string().min(1).max(1000),
    txHash: z.string().min(1).optional(),
    flags: z.array(AgentFlag),
    /** Instruction-like passages from the invoice, for the owner only: render as text, never HTML. */
    suspiciousText: z.array(z.string().max(400)).max(20),
  })
  .refine((o) => (o.decision === "paid") === (o.ruleCode === "OK"), "decision is paid exactly when ruleCode is OK");
export type InvoiceOutcome = z.infer<typeof InvoiceOutcome>;

/** POST /agent/invoices answer. The backend writes `explanation` into the audit log. */
export const ProcessInvoiceResponse = z.strictObject({ outcome: InvoiceOutcome, explanation: AgentExplanation });
export type ProcessInvoiceResponse = z.infer<typeof ProcessInvoiceResponse>;

export const AgentErrorCode = z.enum([
  "unauthorized",
  "payload_too_large",
  "invalid_json",
  "invalid_request",
  "invoice_in_flight",
  "not_found",
  "internal_error",
]);
export type AgentErrorCode = z.infer<typeof AgentErrorCode>;

/** Every error the agent service returns: a stable code and a short fixed message, never a stack or model text. */
export const AgentError = z.strictObject({ error: AgentErrorCode, message: z.string().min(1).max(200) });
export type AgentError = z.infer<typeof AgentError>;
