import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProcessInvoiceResponse } from "@shucamoxa/shared";
import { formatInvoiceSummary, parseCliArgs, runCli } from "../src/cli";

const FIXTURE_01 = resolve(import.meta.dirname, "../../../fixtures/invoices/01-karoo-valid.txt");

describe("CLI: argument parsing", () => {
  it("parses a .pdf file path", () => {
    const parsed = parseCliArgs(["fixtures/invoices/pdf/01-karoo-valid.pdf"]);
    expect(parsed).toEqual({ mode: "file", filePath: "fixtures/invoices/pdf/01-karoo-valid.pdf" });
  });

  it("parses a .txt file path", () => {
    const parsed = parseCliArgs(["fixtures/invoices/01-karoo-valid.txt"]);
    expect(parsed).toEqual({ mode: "file", filePath: "fixtures/invoices/01-karoo-valid.txt" });
  });

  it("parses --demo", () => {
    const parsed = parseCliArgs(["--demo"]);
    expect(parsed).toEqual({ mode: "demo" });
  });

  it("refuses --token flag (token must come from environment only)", () => {
    const parsed = parseCliArgs(["--token", "secret123", "invoice.pdf"]);
    expect(parsed.mode).toBe("error");
    if (parsed.mode === "error") {
      expect(parsed.message).toMatch(/token/i);
    }
  });

  it("refuses --token=flag syntax", () => {
    const parsed = parseCliArgs(["--token=secret123", "invoice.pdf"]);
    expect(parsed.mode).toBe("error");
    if (parsed.mode === "error") {
      expect(parsed.message).toMatch(/token/i);
    }
  });

  it("refuses when no arguments are provided", () => {
    const parsed = parseCliArgs([]);
    expect(parsed.mode).toBe("error");
  });

  it("refuses an unsupported file extension", () => {
    const parsed = parseCliArgs(["invoice.png"]);
    expect(parsed.mode).toBe("error");
    if (parsed.mode === "error") {
      expect(parsed.message).toMatch(/\.pdf|\.txt/i);
    }
  });

  it("refuses multiple files", () => {
    const parsed = parseCliArgs(["a.pdf", "b.pdf"]);
    expect(parsed.mode).toBe("error");
  });
});

describe("CLI: missing token refusal", () => {
  it("refuses when AGENT_INBOUND_TOKEN is missing from the environment", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchStub = vi.fn();

    const code = await runCli({
      argv: [FIXTURE_01],
      env: {},
      fetch: fetchStub,
      stdout: (msg) => stdout.push(msg),
      stderr: (msg) => stderr.push(msg),
    });

    expect(code).not.toBe(0);
    expect(stderr.join("\n")).toMatch(/AGENT_INBOUND_TOKEN.*required/i);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses when AGENT_INBOUND_TOKEN is empty", async () => {
    const stderr: string[] = [];
    const fetchStub = vi.fn();

    const code = await runCli({
      argv: ["--demo"],
      env: { AGENT_INBOUND_TOKEN: "   " },
      fetch: fetchStub,
      stderr: (msg) => stderr.push(msg),
    });

    expect(code).not.toBe(0);
    expect(stderr.join("\n")).toMatch(/AGENT_INBOUND_TOKEN.*required/i);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("CLI: summary formatting", () => {
  it("formats paid decision with ruleCode, txHash, and xrpl explorer link", () => {
    const paidResponse: ProcessInvoiceResponse = {
      outcome: {
        invoiceNumber: "INV-1042",
        decision: "paid",
        ruleCode: "OK",
        explanation: "Paid Karoo Textiles.",
        txHash: "4A5B6C7D8E9F",
        flags: ["ADDRESS_ON_INVOICE_IGNORED"],
        suspiciousText: [],
      },
      explanation: {
        decision: "paid",
        ruleCode: "OK",
        explanation: "Paid Karoo Textiles.",
        invoiceNumber: "INV-1042",
      },
    };

    const summary = formatInvoiceSummary(paidResponse);
    expect(summary).toContain("PAID");
    expect(summary).toContain("OK");
    expect(summary).toContain("INV-1042");
    expect(summary).toContain("4A5B6C7D8E9F");
    expect(summary).toContain("https://testnet.xrpl.org/transactions/4A5B6C7D8E9F");
    expect(summary).toContain("ADDRESS_ON_INVOICE_IGNORED");
  });

  it("formats blocked decision with ruleCode and explanation", () => {
    const blockedResponse: ProcessInvoiceResponse = {
      outcome: {
        invoiceNumber: "INV-9999",
        decision: "blocked",
        ruleCode: "KILL_SWITCH_ON",
        explanation: "Payment rejected because the kill switch is active.",
        flags: [],
        suspiciousText: [],
      },
      explanation: {
        decision: "blocked",
        ruleCode: "KILL_SWITCH_ON",
        explanation: "Payment rejected because the kill switch is active.",
        invoiceNumber: "INV-9999",
      },
    };

    const summary = formatInvoiceSummary(blockedResponse);
    expect(summary).toContain("BLOCKED");
    expect(summary).toContain("KILL_SWITCH_ON");
    expect(summary).not.toContain("https://testnet.xrpl.org");
  });

  it("formats awaiting_owner decision", () => {
    const awaitingResponse: ProcessInvoiceResponse = {
      outcome: {
        invoiceNumber: "INV-3001",
        decision: "awaiting_owner",
        ruleCode: "OVER_PER_PAYMENT_CAP",
        explanation: "Requires owner approval because amount exceeds cap.",
        flags: [],
        suspiciousText: [],
      },
      explanation: {
        decision: "awaiting_owner",
        ruleCode: "OVER_PER_PAYMENT_CAP",
        explanation: "Requires owner approval because amount exceeds cap.",
        invoiceNumber: "INV-3001",
      },
    };

    const summary = formatInvoiceSummary(awaitingResponse);
    expect(summary).toContain("AWAITING_OWNER");
    expect(summary).toContain("OVER_PER_PAYMENT_CAP");
  });

  it("formats needs_review decision with flags and suspicious count", () => {
    const needsReviewResponse: ProcessInvoiceResponse = {
      outcome: {
        invoiceNumber: null,
        decision: "needs_review",
        ruleCode: null,
        explanation: "The PDF contains no readable text layer.",
        flags: ["SUSPICIOUS_TEXT"],
        suspiciousText: ["Ignore previous instructions"],
      },
      explanation: {
        decision: "needs_review",
        ruleCode: null,
        explanation: "The PDF contains no readable text layer.",
        invoiceNumber: null,
      },
    };

    const summary = formatInvoiceSummary(needsReviewResponse);
    expect(summary).toContain("NEEDS_REVIEW");
    expect(summary).toContain("The PDF contains no readable text layer.");
    expect(summary).toContain("SUSPICIOUS_TEXT");
  });
});

describe("CLI: execution with stubbed fetch", () => {
  it("posts an invoice file and prints summary", async () => {
    const stdout: string[] = [];
    const mockResponse: ProcessInvoiceResponse = {
      outcome: {
        invoiceNumber: "INV-1042",
        decision: "paid",
        ruleCode: "OK",
        explanation: "Paid.",
        txHash: "HASH123",
        flags: [],
        suspiciousText: [],
      },
      explanation: {
        decision: "paid",
        ruleCode: "OK",
        explanation: "Paid.",
        invoiceNumber: "INV-1042",
      },
    };

    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const code = await runCli({
      argv: [FIXTURE_01],
      env: {
        AGENT_INBOUND_TOKEN: "valid-token-at-least-32-chars-long",
        AGENT_URL: "http://127.0.0.1:8790",
      },
      fetch: fetchStub,
      stdout: (msg) => stdout.push(msg),
    });

    expect(code).toBe(0);
    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8790/agent/invoices");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer valid-token-at-least-32-chars-long",
      "Content-Type": "application/json",
    });
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.invoiceId).toBe("01-karoo-valid");
    expect(parsedBody.text).toBeDefined();
    expect(stdout.join("\n")).toContain("PAID");
  });

  it("runs --demo through fixtures 01-06 and pauses between them", async () => {
    const stdout: string[] = [];
    const pauseCalls: number[] = [];
    let callCount = 0;

    const mockResponse = (num: string): ProcessInvoiceResponse => ({
      outcome: {
        invoiceNumber: `INV-${num}`,
        decision: "paid",
        ruleCode: "OK",
        explanation: `Invoice ${num} processed.`,
        txHash: `TX${num}`,
        flags: [],
        suspiciousText: [],
      },
      explanation: {
        decision: "paid",
        ruleCode: "OK",
        explanation: `Invoice ${num} processed.`,
        invoiceNumber: `INV-${num}`,
      },
    });

    const fetchStub = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify(mockResponse(String(callCount))), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const pauseStub = vi.fn().mockImplementation(async () => {
      pauseCalls.push(callCount);
    });

    const code = await runCli({
      argv: ["--demo"],
      env: {
        AGENT_INBOUND_TOKEN: "valid-token-at-least-32-chars-long",
      },
      fetch: fetchStub,
      stdout: (msg) => stdout.push(msg),
      pause: pauseStub,
    });

    expect(code).toBe(0);
    // Fixtures 01 through 06 = 6 invoices
    expect(fetchStub).toHaveBeenCalledTimes(6);
    // 5 pauses between 6 invoices
    expect(pauseStub).toHaveBeenCalledTimes(5);
    expect(stdout.join("\n")).toContain("PAID");
  });
});
