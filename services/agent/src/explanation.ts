import { InvoiceNumber, type ProcessInvoiceResponse } from "@shucamoxa/shared";
import type { AgentOutcome } from "./agent";
import { redactAddresses } from "./tools";

/** Most suspicious passages returned for one invoice; the rest are dropped so the answer still parses. */
export const MAX_SUSPICIOUS_TEXT_ITEMS = 20;

/**
 * The POST /agent/invoices answer for one outcome. The extracted invoice number is model output, so
 * one that is not a valid InvoiceNumber is reported as null rather than passed on. Suspicious text is
 * kept for the owner, with any wallet address removed.
 */
export function invoiceResponse(outcome: AgentOutcome): ProcessInvoiceResponse {
  const parsed = InvoiceNumber.safeParse(outcome.invoiceNumber);
  const invoiceNumber = parsed.success ? parsed.data : null;
  const suspiciousText = outcome.suspiciousText.slice(0, MAX_SUSPICIOUS_TEXT_ITEMS).map((text) => redactAddresses(text) as string);
  const { decision, ruleCode, explanation } = outcome;
  return {
    outcome: { ...outcome, invoiceNumber, suspiciousText },
    explanation: { decision, ruleCode, explanation, invoiceNumber },
  };
}
