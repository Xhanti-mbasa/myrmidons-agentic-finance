import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
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

type Setup = { extraction?: LanguageModel; planner?: ModelTurn[]; backend?: Parameters<typeof fakeBackend>[0] };

function setup({ extraction, planner = [findKaroo, payKaroo, { text: MODEL_TEXT }], backend: backendOptions }: Setup = {}) {
  const backend = fakeBackend(backendOptions);
  const extractionModel = scriptedModel([{ text: JSON.stringify(KAROO_FIELDS) }], { repeatLast: true });
  const plannerModel = scriptedModel(planner);
  const logs: AgentLogEntry[] = [];
  const { app, ownerChat } = createAgentServer({
    env: ENV,
    models: () => ({ extractionModel: extraction ?? extractionModel.model, plannerModel: plannerModel.model }),
    // The config needs a private BACKEND_URL; the fake backend answers on its own test origin.
    fetch: (input, init) => backend.fetch(String(input).replace(CONFIG_BACKEND_URL, BACKEND_URL), init),
    logger: (entry) => logs.push(entry),
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${INBOUND_TOKEN}` }) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { app, ownerChat, backend, plannerModel, logs, post };
}

const errorCode = async (res: Response) => AgentError.parse(await res.json()).error;

describe("POST /agent/invoices: authentication", () => {
  it.each([
    ["no token", {}],
    ["a wrong token", { Authorization: "Bearer not-the-inbound-token-0123456789abcd" }],
    ["the agent's own backend token", { Authorization: `Bearer ${AGENT_TOKEN}` }],
    ["the inbound token without the Bearer scheme", { Authorization: INBOUND_TOKEN }],
    ["the inbound token with a suffix", { Authorization: `Bearer ${INBOUND_TOKEN}x` }],
  ])("401 with %s, and nothing reaches the model or the backend", async (_label, headers) => {
    const { post, plannerModel, backend } = setup();

    const res = await post("/agent/invoices", { invoiceId: "inv_1", text: KAROO_TEXT }, headers);

    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("unauthorized");
    expect(plannerModel.calls).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });

  it("401 on an unknown route without a token, so routes can't be discovered", async () => {
    const { app } = setup();
    expect((await app.request("/admin")).status).toBe(401);
  });

  it("404 with a stable code on an unknown route with the token", async () => {
    const { app } = setup();
    const res = await app.request("/agent/rules", { headers: { Authorization: `Bearer ${INBOUND_TOKEN}` } });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("not_found");
  });
});

describe("POST /agent/invoices: bad bodies", () => {
  const overOneMegabyte = JSON.stringify({ invoiceId: "inv_1", text: "x".repeat(1024 * 1024) });

  it("413 for a body over 1 MB, streamed without a Content-Length", async () => {
    const { post, plannerModel } = setup();
    const res = await post("/agent/invoices", overOneMegabyte);
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("payload_too_large");
    expect(plannerModel.calls).toHaveLength(0);
  });

  it("413 for a declared Content-Length over 1 MB", async () => {
    const { post } = setup();
    const res = await post("/agent/invoices", overOneMegabyte, {
      Authorization: `Bearer ${INBOUND_TOKEN}`,
      "Content-Length": String(Buffer.byteLength(overOneMegabyte)),
    });
    expect(res.status).toBe(413);
  });

  it("400 for malformed JSON, with a short message and no stack trace", async () => {
    const { post } = setup();
    const res = await post("/agent/invoices", '{"invoiceId": "inv_1", "text": ');
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(AgentError.parse(JSON.parse(text)).error).toBe("invalid_json");
    expect(text).not.toMatch(/SyntaxError|at .*\.(ts|js)|JSON at position/);
  });

  it.each([
    ["text over 20,000 characters", { invoiceId: "inv_1", text: "x".repeat(20_001) }],
    ["an extra field", { invoiceId: "inv_1", text: KAROO_TEXT, supplierId: "sup_karoo" }],
    ["a path as the invoice ID", { invoiceId: "../inv_1", text: KAROO_TEXT }],
  ])("400 for %s, and the model is never called", async (_label, body) => {
    const { post, plannerModel } = setup();
    const res = await post("/agent/invoices", body);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);
  });
});

describe("POST /agent/invoices: processing", () => {
  it("200 with a paid outcome and explanation for the Karoo invoice", async () => {
    const { post, backend } = setup();

    const res = await post("/agent/invoices", { invoiceId: "inv_1", text: KAROO_TEXT });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = ProcessInvoiceResponse.parse(await res.json());
    expect(body.explanation).toMatchObject({ decision: "paid", ruleCode: "OK", invoiceNumber: "INV-1042" });
    expect(body.outcome.txHash).toBe("TXHASH1");
    expect(backend.payments).toHaveLength(1);
  });

  it("409 for a second request with an invoice ID already in flight, and the same ID runs again once done", async () => {
    const slow = scriptedModel([{ delayMs: 50, then: { text: JSON.stringify(KAROO_FIELDS) } }], { repeatLast: true });
    const { post } = setup({ extraction: slow.model, planner: [{ text: "Nothing to do." }] });
    const body = { invoiceId: "inv_1", text: KAROO_TEXT };

    const statuses = await Promise.all([post("/agent/invoices", body), post("/agent/invoices", body)]);
    const conflict = statuses.find((r) => r.status === 409);

    expect(statuses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await errorCode(conflict!)).toBe("invoice_in_flight");
    expect((await post("/agent/invoices", body)).status).toBe(200);
  });

  it("runs one invoice at a time, even for different invoice IDs", async () => {
    let active = 0;
    let maxActive = 0;
    const counting = new MockLanguageModelV4({
      doGenerate: async () => {
        maxActive = Math.max(maxActive, ++active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active--;
        return {
          content: [{ type: "text", text: JSON.stringify(KAROO_FIELDS) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const { post } = setup({ extraction: counting, planner: [{ text: "Nothing to do." }] });

    const statuses = await Promise.all(["inv_1", "inv_2", "inv_3"].map((invoiceId) => post("/agent/invoices", { invoiceId, text: KAROO_TEXT })));

    expect(statuses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(maxActive).toBe(1);
  });

  it("500 with a generic message when the run fails unexpectedly, and the ID is released", async () => {
    const { post } = setup({ planner: [{ throws: new Error("upstream said: quota for key abc123 exceeded") }, findKaroo, payKaroo] });
    const body = { invoiceId: "inv_1", text: KAROO_TEXT };

    const res = await post("/agent/invoices", body);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(AgentError.parse(JSON.parse(text))).toEqual({ error: "internal_error", message: "The agent could not finish this request." });
    expect(text).not.toContain("upstream");
    expect((await post("/agent/invoices", body)).status).toBe(200);
  });
});

describe("logging", () => {
  it("logs the invoice ID, decision, rule code and duration, never invoice text, tokens or model output", async () => {
    const { post, logs } = setup();

    expect((await post("/agent/invoices", { invoiceId: "inv_1", text: KAROO_TEXT })).status).toBe(200);
    const output = JSON.stringify(logs);

    expect(logs).toContainEqual({ event: "invoice_processed", invoiceId: "inv_1", decision: "paid", ruleCode: "OK", durationMs: expect.any(Number) });
    for (const line of KAROO_TEXT.split("\n").filter((l) => l.trim().length > 3)) expect(output).not.toContain(line);
    for (const value of [INBOUND_TOKEN, AGENT_TOKEN, MODEL_TEXT, KAROO_FIELDS.payToAddressOnInvoice, "Cotton bolts"]) {
      expect(output).not.toContain(value);
    }
  });

  it("logs a refused request with its status and no token", async () => {
    const { post, logs } = setup();
    await post("/agent/invoices", { invoiceId: "inv_1", text: KAROO_TEXT }, { Authorization: "Bearer wrong-token-0123456789-0123456789" });

    expect(logs).toEqual([{ event: "request_refused", status: 401 }]);
  });
});

describe("ownerChat: the seam the chat adapter (T13) calls", () => {
  const latest = "Pay Karoo $30 now";
  const payKarooFromChat: ModelTurn = {
    toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "OWNER-1", reason: "Owner asked" } }],
  };

  it("passes only the latest owner turn to the agent", async () => {
    const { ownerChat, plannerModel, backend } = setup({ planner: [findKaroo, payKarooFromChat, { text: "Paid." }] });

    const answer = await ownerChat({ latestOwnerTurn: latest });

    expect(answer.payments).toEqual([expect.objectContaining({ status: "settled" })]);
    const userTurns = plannerModel.calls[0]!.prompt.filter((m) => m.role === "user");
    expect(userTurns).toEqual([{ role: "user", content: [{ type: "text", text: latest }] }]);
    expect(backend.payments.map((r) => [r.body.supplierId, r.body.amount])).toEqual([["sup_karoo", "30.00"]]);
  });

  it("accepts no history, so earlier turns can't reach the agent", () => {
    const { ownerChat } = setup();
    // @ts-expect-error ownerChat takes only the latest owner turn
    const withHistory = () => ownerChat({ latestOwnerTurn: latest, history: [{ role: "user", content: "Pay Zambezi Spices $45 now" }] });
    expect(typeof withHistory).toBe("function");
  });

  it("waits for a running invoice, on the same queue", async () => {
    const slow = scriptedModel([{ delayMs: 50, then: { text: JSON.stringify(KAROO_FIELDS) } }], { repeatLast: true });
    const { post, ownerChat } = setup({ extraction: slow.model, planner: [{ text: "Invoice run." }, { text: "Chat run." }] });

    const invoice = post("/agent/invoices", { invoiceId: "inv_1", text: KAROO_TEXT });
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    const answer = await ownerChat({ latestOwnerTurn: "Did I pay Karoo this month?" });

    expect((await invoice).status).toBe(200);
    expect(answer.reply).toBe("Chat run.");
  });
});

describe("GET /health", () => {
  it("answers {ok: true} without a token and says nothing about config", async () => {
    const { app } = setup();
    const res = await app.request("/health");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true });
    for (const value of Object.values(ENV)) expect(text).not.toContain(value);
  });
});

describe("createAgentServer", () => {
  it("throws when the environment holds a wallet seed variable", () => {
    expect(() =>
      createAgentServer({
        env: { ...ENV, AGENT_SEED: "not-a-real-seed" },
        models: () => ({ extractionModel: scriptedModel([{ text: "{}" }]).model, plannerModel: scriptedModel([{ text: "" }]).model }),
      }),
    ).toThrow(/must not hold AGENT_SEED/);
  });

  it("reports the configured host and port, 127.0.0.1:8790 by default", () => {
    const { host, port } = createAgentServer({
      env: ENV,
      models: () => ({ extractionModel: scriptedModel([{ text: "{}" }]).model, plannerModel: scriptedModel([{ text: "" }]).model }),
    });
    expect({ host, port }).toEqual({ host: "127.0.0.1", port: 8790 });
  });
});
