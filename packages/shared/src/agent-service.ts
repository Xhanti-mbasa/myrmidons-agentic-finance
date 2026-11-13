import { z } from "zod";
import { InvoiceNumber } from "./ids";
import { RuleCode } from "./policy";
import { AgentDecision, AgentExplanation, PayResult } from "./agent-api";

/** The agent HTTP service (T12): what the backend sends it and what it answers. */

/** Largest invoice text the agent accepts, in characters. */
export const MAX_INVOICE_TEXT_CHARS = 20_000;

/** The backend's ID for an uploaded invoice. Never a path: ASCII letters, digits, "_" and "-" only. */
export const AgentInvoiceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "invoice ID must be 1-64 ASCII letters, digits, _ or -");
export type AgentInvoiceId = z.infer<typeof AgentInvoiceId>;

/** POST /agent/invoices body. Accepts either raw text or a base64-encoded PDF. */
export const ProcessInvoiceRequest = z
  .strictObject({
    invoiceId: AgentInvoiceId,
    text: z.string().min(1).max(MAX_INVOICE_TEXT_CHARS).optional(),
    pdfBase64: z.string().min(1).optional(),
  })
  .refine(
    (req) => (req.text !== undefined) !== (req.pdfBase64 !== undefined),
    "exactly one of text or pdfBase64 must be provided",
  );
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

/** Largest chat message the agent accepts, in characters. */
export const MAX_CHAT_MESSAGE_CHARS = 2_000;

/** POST /agent/chat body. */
export const ChatRequest = z.strictObject({
  message: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const ToolPhase = z.enum(["start", "end"]);
export type ToolPhase = z.infer<typeof ToolPhase>;

/**
 * tool event payload: only name, phase, ok, and optionally refused or ruleCode.
 * Never arguments, inputs, results or wallet addresses.
 */
export const ChatStreamToolEvent = z.strictObject({
  name: z.string().min(1),
  phase: ToolPhase,
  ok: z.boolean(),
  refused: z.boolean().optional(),
  ruleCode: RuleCode.optional(),
});
export type ChatStreamToolEvent = z.infer<typeof ChatStreamToolEvent>;

export const ChatStreamTextEvent = z.strictObject({
  delta: z.string(),
});
export type ChatStreamTextEvent = z.infer<typeof ChatStreamTextEvent>;

export const ChatStreamSummaryEvent = z.strictObject({
  summary: z.string(),
  payments: z.array(PayResult),
});
export type ChatStreamSummaryEvent = z.infer<typeof ChatStreamSummaryEvent>;

export const ChatStreamErrorEvent = z.strictObject({
  message: z.string(),
});
export type ChatStreamErrorEvent = z.infer<typeof ChatStreamErrorEvent>;

export const ChatStreamDoneEvent = z.strictObject({});
export type ChatStreamDoneEvent = z.infer<typeof ChatStreamDoneEvent>;

export type ChatStreamEvent =
  | { event: "tool"; data: ChatStreamToolEvent }
  | { event: "text"; data: ChatStreamTextEvent }
  | { event: "summary"; data: ChatStreamSummaryEvent }
  | { event: "error"; data: ChatStreamErrorEvent }
  | { event: "done"; data: ChatStreamDoneEvent };
