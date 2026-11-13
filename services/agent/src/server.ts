import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { LanguageModel } from "ai";
import {
  AgentError,
  ChatRequest,
  ProcessInvoiceRequest,
  ProcessInvoiceResponse,
  type AgentDecision,
  type AgentErrorCode,
  type RuleCode,
} from "@shucamoxa/shared";
import { createAgent, type AgentOutcome } from "./agent";
import { loadAgentServerConfig, type AgentConfig } from "./config";
import { invoiceResponse } from "./explanation";
import type { RunLimits } from "./limits";
import { decodeAndValidatePdf, extractPdfText, InvalidPdfError, PdfTooLargeError } from "./pdf";

/** Largest request body read, in bytes, counted as it streams in. */
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_PDF_REQUEST_BYTES = 10 * 1024 * 1024;

/** What the service logs. Only IDs, decisions, codes, counts and timings: never invoice text, tokens or model output. */
export type AgentLogEntry =
  | { event: "invoice_processed"; invoiceId: string; decision: AgentDecision; ruleCode: RuleCode | null; durationMs: number }
  | { event: "invoice_failed"; invoiceId: string; durationMs: number }
  | { event: "request_refused"; status: number };
export type AgentLogger = (entry: AgentLogEntry) => void;

export type AgentServerDeps = {
  /** The startup environment; refused if it holds a seed, key or database credential (T09). */
  env: Record<string, string | undefined>;
  models: (config: AgentConfig) => { extractionModel: LanguageModel; plannerModel: LanguageModel };
  fetch?: typeof fetch;
  logger?: AgentLogger;
  limits?: Partial<RunLimits>;
};

const ERRORS: Record<AgentErrorCode, { status: 400 | 401 | 404 | 409 | 413 | 500; message: string }> = {
  unauthorized: { status: 401, message: "A valid bearer token is required." },
  payload_too_large: { status: 413, message: "The request body is over 1 MB." },
  invalid_json: { status: 400, message: "The request body is not valid JSON." },
  invalid_request: { status: 400, message: "The request body does not match the expected shape." },
  invoice_in_flight: { status: 409, message: "This invoice is already being processed." },
  not_found: { status: 404, message: "No such route." },
  internal_error: { status: 500, message: "The agent could not finish this request." },
};

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * The agent as an HTTP service. Every route but /health needs AGENT_INBOUND_TOKEN. Runs are serial:
 * one at a time, and a second request for an invoice ID already queued or running is refused with
 * 409. Every answer is parsed with its shared schema before it is sent.
 */
export function createAgentServer(deps: AgentServerDeps) {
  const config = loadAgentServerConfig(deps.env);
  const log = deps.logger ?? ((entry: AgentLogEntry) => console.log(JSON.stringify(entry)));
  const agent = createAgent({ ...deps.models(config), backendUrl: config.backendUrl, backendToken: config.backendToken, fetch: deps.fetch, limits: deps.limits });
  const expectedToken = digest(config.inboundToken);

  let tail: Promise<unknown> = Promise.resolve();
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
  const inFlight = new Set<string>();

  /**
   * The one entry point for owner chat, for the chat adapter (T13) to call. It takes only the latest
   * owner turn, never a history, and runs on the same queue as invoices.
   */
  const ownerChat = ({ latestOwnerTurn }: { latestOwnerTurn: string }) => serially(() => agent.chat(latestOwnerTurn));

  const fail = (c: Context, code: AgentErrorCode) => {
    const { status, message } = ERRORS[code];
    if (status < 500) log({ event: "request_refused", status });
    return c.json(AgentError.parse({ error: code, message }), status);
  };
  const readJson = async (c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    try {
      return { ok: true, value: JSON.parse(await c.req.text()) };
    } catch {
      return { ok: false };
    }
  };
  const since = (started: number) => Math.round(performance.now() - started);

  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("*", async (c, next) => {
    const match = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
    const matches = timingSafeEqual(digest(match?.[1] ?? ""), expectedToken);
    if (!match || !matches) return fail(c, "unauthorized");
    await next();
  });
  app.use("*", async (c, next) => {
    if (!c.req.raw.body) return next();
    const rawHeaders = c.req.raw.headers;
    const hasTransferEncoding = rawHeaders.has("transfer-encoding");
    const contentLength = rawHeaders.has("content-length") && !hasTransferEncoding
      ? parseInt(rawHeaders.get("content-length") || "0", 10)
      : null;

    if (contentLength !== null && contentLength > MAX_PDF_REQUEST_BYTES) {
      return fail(c, "payload_too_large");
    }

    let size = 0;
    let buffer = new Uint8Array(0);
    const rawReader = c.req.raw.body.getReader();
    let checkedType = false;
    let maxSize = MAX_REQUEST_BYTES;

    for (;;) {
      const { done, value } = await rawReader.read();
      if (done) break;
      const offset = size;
      size += value.length;

      if (!checkedType) {
        const prefix = new TextDecoder().decode(value.subarray(0, 1024));
        if (prefix.includes('"pdfBase64"')) {
          maxSize = MAX_PDF_REQUEST_BYTES;
        }
        checkedType = true;
        if (contentLength !== null && contentLength > maxSize) {
          await rawReader.cancel();
          return fail(c, "payload_too_large");
        }
      }

      if (size > maxSize) {
        await rawReader.cancel();
        return fail(c, "payload_too_large");
      }

      if (size > buffer.length) {
        const grown = new Uint8Array(Math.min(maxSize, Math.max(size, buffer.length * 2)));
        grown.set(buffer.subarray(0, offset));
        buffer = grown;
      }
      buffer.set(value, offset);
    }

    c.req.raw = new Request(c.req.raw, { body: buffer.subarray(0, size) });
    return next();
  });

  app.post("/agent/invoices", async (c) => {
    const body = await readJson(c);
    if (!body.ok) return fail(c, "invalid_json");
    const request = ProcessInvoiceRequest.safeParse(body.value);
    if (!request.success) return fail(c, "invalid_request");
    const { invoiceId, text: rawText, pdfBase64 } = request.data;
    if (inFlight.has(invoiceId)) return fail(c, "invoice_in_flight");

    let pdfBytes: Uint8Array | undefined;
    if (pdfBase64 !== undefined) {
      try {
        pdfBytes = decodeAndValidatePdf(pdfBase64);
      } catch (err) {
        if (err instanceof PdfTooLargeError) return fail(c, "payload_too_large");
        return fail(c, "invalid_request");
      }
    }

    inFlight.add(invoiceId);
    const started = performance.now();
    try {
      let invoiceText: string;
      if (pdfBytes !== undefined) {
        const extraction = await extractPdfText(pdfBytes);
        if (extraction.status === "needs_review") {
          const outcome: AgentOutcome = {
            invoiceNumber: null,
            decision: "needs_review",
            ruleCode: null,
            explanation: extraction.reason,
            flags: [],
            suspiciousText: [],
          };
          const response = ProcessInvoiceResponse.parse(invoiceResponse(outcome));
          log({ event: "invoice_processed", invoiceId, decision: "needs_review", ruleCode: null, durationMs: since(started) });
          return c.json(response);
        }
        invoiceText = extraction.text;
      } else {
        invoiceText = rawText!;
      }

      const response = ProcessInvoiceResponse.parse(invoiceResponse(await serially(() => agent.processInvoice(invoiceText))));
      const { decision, ruleCode } = response.outcome;
      log({ event: "invoice_processed", invoiceId, decision, ruleCode, durationMs: since(started) });
      return c.json(response);
    } catch {
      log({ event: "invoice_failed", invoiceId, durationMs: since(started) });
      return fail(c, "internal_error");
    } finally {
      inFlight.delete(invoiceId);
    }
  });

  app.post("/agent/chat", async (c) => {
    const body = await readJson(c);
    if (!body.ok) return fail(c, "invalid_json");
    const request = ChatRequest.safeParse(body.value);
    if (!request.success) return fail(c, "invalid_request");

    return streamSSE(c, async (stream) => {
      await serially(async () => {
        for await (const event of agent.chatStream(request.data.message, c.req.raw.signal)) {
          await stream.writeSSE({
            event: event.event,
            data: typeof event.data === "string" ? event.data : JSON.stringify(event.data),
          });
        }
      });
    });
  });

  app.notFound((c) => fail(c, "not_found"));
  app.onError((_error, c) => fail(c, "internal_error"));
  return { app, ownerChat, host: config.host, port: config.port };
}
