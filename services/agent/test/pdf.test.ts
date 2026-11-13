import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AgentError, ProcessInvoiceResponse } from "@shucamoxa/shared";
import { createAgentServer, type AgentLogEntry } from "../src/server";
import { scriptedModel, type ModelTurn } from "./support/scripted-model";
import { AGENT_TOKEN, BACKEND_URL, fakeBackend } from "./support/fake-backend";
import { invoiceTextFor, KAROO_FIELDS } from "./support/invoices";

const INBOUND_TOKEN = "inbound-token-for-the-backend-0123456789";
const CONFIG_BACKEND_URL = "http://127.0.0.1:8787";
const ENV = {
  MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
  MODEL_NAME: "qwen-test-model",
  BACKEND_URL: CONFIG_BACKEND_URL,
  AGENT_BACKEND_TOKEN: AGENT_TOKEN,
  AGENT_INBOUND_TOKEN: INBOUND_TOKEN,
};
const KAROO_TEXT = invoiceTextFor(KAROO_FIELDS);

const findKaroo: ModelTurn = { toolCalls: [{ tool: "find_supplier", input: { name: "Karoo Textiles" } }] };
const payKaroo: ModelTurn = {
  toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042", reason: "Cotton bolts" } }],
};
const MODEL_TEXT = "Paid Karoo Textiles for the cotton bolts.";

function setup(planner: ModelTurn[] = [findKaroo, payKaroo, { text: MODEL_TEXT }]) {
  const backend = fakeBackend();
  const extractionModel = scriptedModel([{ text: JSON.stringify(KAROO_FIELDS) }], { repeatLast: true });
  const plannerModel = scriptedModel(planner);
  const logs: AgentLogEntry[] = [];
  const { app } = createAgentServer({
    env: ENV,
    models: () => ({ extractionModel: extractionModel.model, plannerModel: plannerModel.model }),
    fetch: (input, init) => backend.fetch(String(input).replace(CONFIG_BACKEND_URL, BACKEND_URL), init),
    logger: (entry) => logs.push(entry),
  });
  const post = (body: unknown) =>
    app.request("/agent/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INBOUND_TOKEN}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { app, backend, plannerModel, logs, post };
}

const errorCode = async (res: Response) => AgentError.parse(await res.json()).error;

async function makePdfWithText(text: string, pages = 1): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([600, 800]);
    const lines = text.split("\n");
    let y = 750;
    for (const line of lines) {
      if (line.trim().length > 0) {
        page.drawText(line, { x: 50, y, size: 12, font });
      }
      y -= 16;
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}

async function makeEmptyPdf(pages = 1): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([600, 800]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}

describe("POST /agent/invoices: PDF invoices", () => {
  it("builds a PDF with pdf-lib containing Karoo invoice text; POST {invoiceId, pdfBase64} -> paid", async () => {
    const { post, backend } = setup();
    const pdfBase64 = await makePdfWithText(KAROO_TEXT, 1);

    const res = await post({ invoiceId: "inv_karoo_pdf", pdfBase64 });

    expect(res.status).toBe(200);
    const body = ProcessInvoiceResponse.parse(await res.json());
    expect(body.outcome.decision).toBe("paid");
    expect(body.outcome.ruleCode).toBe("OK");
    expect(body.outcome.txHash).toBe("TXHASH1");
    expect(backend.payments).toHaveLength(1);
  });

  it("both text and pdfBase64 -> 400", async () => {
    const { post, plannerModel } = setup();
    const pdfBase64 = await makePdfWithText(KAROO_TEXT, 1);

    const res = await post({ invoiceId: "inv_both", text: KAROO_TEXT, pdfBase64 });

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);
  });

  it("neither text nor pdfBase64 -> 400", async () => {
    const { post, plannerModel } = setup();

    const res = await post({ invoiceId: "inv_neither" });

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);
  });

  it("bytes not starting with %PDF- -> 400", async () => {
    const { post, plannerModel } = setup();
    const notPdf = Buffer.from("NOT_A_PDF_DOCUMENT_CONTENT").toString("base64");

    const res = await post({ invoiceId: "inv_bad_magic", pdfBase64: notPdf });

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);
  });

  it("over 2 MB decoded -> 413", async () => {
    const { post, plannerModel } = setup();
    // 2 MB + 1 byte decoded, with valid %PDF- magic bytes at the start
    const over2MB = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(2 * 1024 * 1024 - 8, "x"),
    ]).toString("base64");

    const res = await post({ invoiceId: "inv_over_2mb", pdfBase64: over2MB });

    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("payload_too_large");
    expect(plannerModel.calls).toHaveLength(0);
  });

  it("6 pages -> needs_review", async () => {
    const { post, backend } = setup();
    const sixPagePdf = await makePdfWithText(KAROO_TEXT, 6);

    const res = await post({ invoiceId: "inv_six_pages", pdfBase64: sixPagePdf });

    expect(res.status).toBe(200);
    const body = ProcessInvoiceResponse.parse(await res.json());
    expect(body.outcome.decision).toBe("needs_review");
    expect(body.outcome.ruleCode).toBeNull();
    expect(backend.payments).toHaveLength(0);
  });

  it("PDF with no text layer -> needs_review", async () => {
    const { post, backend } = setup();
    const emptyPdf = await makeEmptyPdf(1);

    const res = await post({ invoiceId: "inv_no_text", pdfBase64: emptyPdf });

    expect(res.status).toBe(200);
    const body = ProcessInvoiceResponse.parse(await res.json());
    expect(body.outcome.decision).toBe("needs_review");
    expect(body.outcome.ruleCode).toBeNull();
    expect(backend.payments).toHaveLength(0);
  });
});

