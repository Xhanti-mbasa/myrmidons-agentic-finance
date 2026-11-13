import { describe, expect, it } from "vitest";
import {
  AgentError,
  InvoiceOutcome,
  MAX_INVOICE_TEXT_CHARS,
  ProcessInvoiceRequest,
  ProcessInvoiceResponse,
} from "../src/index";

describe("ProcessInvoiceRequest", () => {
  const valid = { invoiceId: "inv_1", text: "INVOICE" };

  it("accepts an invoice ID and its text", () => {
    expect(ProcessInvoiceRequest.safeParse(valid).success).toBe(true);
    expect(ProcessInvoiceRequest.safeParse({ ...valid, text: "x".repeat(MAX_INVOICE_TEXT_CHARS) }).success).toBe(true);
  });

  it.each([
    ["text over the limit", { ...valid, text: "x".repeat(MAX_INVOICE_TEXT_CHARS + 1) }],
    ["empty text", { ...valid, text: "" }],
    ["an extra field", { ...valid, supplierId: "sup_karoo" }],
    ["an invoice ID with a slash", { ...valid, invoiceId: "../inv_1" }],
    ["an invoice ID with a space", { ...valid, invoiceId: "inv 1" }],
    ["a 65-character invoice ID", { ...valid, invoiceId: "a".repeat(65) }],
    ["no invoice ID", { text: "INVOICE" }],
  ])("rejects %s", (_label, value) => {
    expect(ProcessInvoiceRequest.safeParse(value).success).toBe(false);
  });
});

describe("ProcessInvoiceResponse", () => {
  const outcome = { invoiceNumber: "INV-1042", decision: "paid", ruleCode: "OK", explanation: "Paid.", txHash: "TX1", flags: [], suspiciousText: [] };
  const explanation = { decision: "paid", ruleCode: "OK", explanation: "Paid.", invoiceNumber: "INV-1042" };

  it("accepts an outcome with its explanation", () => {
    expect(ProcessInvoiceResponse.safeParse({ outcome, explanation }).success).toBe(true);
  });

  it.each([
    ["an outcome with an address field", { outcome: { ...outcome, payTo: "rAddress" }, explanation }],
    ["paid without the OK code", { outcome: { ...outcome, ruleCode: "OVER_BUDGET" }, explanation }],
    ["an unknown flag", { outcome: { ...outcome, flags: ["TRUSTED"] }, explanation }],
    ["a bad invoice number", { outcome: { ...outcome, invoiceNumber: "INV 1042" }, explanation }],
    ["an extra top-level field", { outcome, explanation, debug: "x" }],
    ["more than 20 suspicious passages", { outcome: { ...outcome, suspiciousText: Array.from({ length: 21 }, () => "x") }, explanation }],
    ["a suspicious passage over 400 characters", { outcome: { ...outcome, suspiciousText: ["x".repeat(401)] }, explanation }],
    ["no suspiciousText", { outcome: { ...outcome, suspiciousText: undefined }, explanation }],
  ])("rejects %s", (_label, value) => {
    expect(ProcessInvoiceResponse.safeParse(value).success).toBe(false);
  });

  it("is the same outcome shape on its own", () => {
    expect(InvoiceOutcome.safeParse(outcome).success).toBe(true);
  });
});

describe("AgentError", () => {
  it("accepts a stable code and a message", () => {
    expect(AgentError.safeParse({ error: "invoice_in_flight", message: "This invoice is already being processed." }).success).toBe(true);
  });

  it("rejects an unknown code or a stack", () => {
    expect(AgentError.safeParse({ error: "TypeError", message: "x" }).success).toBe(false);
    expect(AgentError.safeParse({ error: "internal_error", message: "x", stack: "at y" }).success).toBe(false);
  });
});
