import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { AgentError } from "@shucamoxa/shared";
import { createAgentServer, type AgentLogEntry } from "../src/server";
import { scriptedModel, type ModelTurn } from "./support/scripted-model";
import { AGENT_TOKEN, BACKEND_URL, fakeBackend } from "./support/fake-backend";

const INBOUND_TOKEN = "inbound-token-for-the-backend-0123456789";
const CONFIG_BACKEND_URL = "http://127.0.0.1:8787";
const ENV = {
  MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
  MODEL_NAME: "qwen-test-model",
  BACKEND_URL: CONFIG_BACKEND_URL,
  AGENT_BACKEND_TOKEN: AGENT_TOKEN,
  AGENT_INBOUND_TOKEN: INBOUND_TOKEN,
};

const findKaroo: ModelTurn = { toolCalls: [{ tool: "find_supplier", input: { name: "Karoo" } }] };
const getRules: ModelTurn = { toolCalls: [{ tool: "get_rules", input: {} }] };
const payKaroo: ModelTurn = {
  toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "30.00", reason: "Owner asked" } }],
};

export type ParsedSSEEvent = { event: string; data: any };

export function parseSSE(body: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  const blocks = body.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    let data = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trim();
      }
    }
    let parsedData: any = data;
    try {
      parsedData = JSON.parse(data);
    } catch {
      // leave as string
    }
    events.push({ event, data: parsedData });
  }
  return events;
}

type Setup = { extraction?: LanguageModel; planner?: ModelTurn[]; backend?: Parameters<typeof fakeBackend>[0] };

function setup({ extraction, planner = [findKaroo, getRules, payKaroo, { text: "Paid Karoo $30." }], backend: backendOptions }: Setup = {}) {
  const backend = fakeBackend(backendOptions);
  const extractionModel = scriptedModel([{ text: "{}" }], { repeatLast: true });
  const plannerModel = scriptedModel(planner);
  const logs: AgentLogEntry[] = [];
  const { app, ownerChat } = createAgentServer({
    env: ENV,
    models: () => ({ extractionModel: extraction ?? extractionModel.model, plannerModel: plannerModel.model }),
    fetch: (input, init) => backend.fetch(String(input).replace(CONFIG_BACKEND_URL, BACKEND_URL), init),
    logger: (entry) => logs.push(entry),
  });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = { Authorization: `Bearer ${INBOUND_TOKEN}` },
    init?: { signal?: AbortSignal },
  ) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: init?.signal,
    });
  return { app, ownerChat, backend, plannerModel, logs, post };
}

const errorCode = async (res: Response) => AgentError.parse(await res.json()).error;

describe("POST /agent/chat: streaming owner-chat endpoint", () => {
  // Test 1: "Pay Karoo $30 now" with scripted planner [find_supplier, get_rules, pay, text]
  it("1. 'Pay Karoo $30 now' streams tool, text deltas, summary, and done events in order", async () => {
    const { post, backend } = setup({
      planner: [findKaroo, getRules, payKaroo, { text: "Paid Karoo $30." }],
    });

    const res = await post("/agent/chat", { message: "Pay Karoo $30 now" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual([
      "tool", // find_supplier start
      "tool", // find_supplier end
      "tool", // get_rules start
      "tool", // get_rules end
      "tool", // pay start
      "tool", // pay end
      "text", // text delta
      "summary", // summary
      "done", // done
    ]);

    expect(events[0]).toEqual({ event: "tool", data: { name: "find_supplier", phase: "start", ok: true } });
    expect(events[1]).toEqual({ event: "tool", data: { name: "find_supplier", phase: "end", ok: true } });
    expect(events[2]).toEqual({ event: "tool", data: { name: "get_rules", phase: "start", ok: true } });
    expect(events[3]).toEqual({ event: "tool", data: { name: "get_rules", phase: "end", ok: true } });
    expect(events[4]).toEqual({ event: "tool", data: { name: "pay", phase: "start", ok: true } });
    expect(events[5]).toEqual({ event: "tool", data: { name: "pay", phase: "end", ok: true, ruleCode: "OK" } });
    expect(events[6]).toEqual({ event: "text", data: { delta: "Paid Karoo $30." } });
    expect(events[7]!.event).toBe("summary");
    expect(events[7]!.data.summary).toBe("Paid 30.00 to sup_karoo, tx TXHASH1.");
    expect(events[7]!.data.payments).toEqual([expect.objectContaining({ status: "settled", ruleCode: "OK", txHash: "TXHASH1" })]);
    expect(events[8]).toEqual({ event: "done", data: {} });
    expect(backend.payments).toHaveLength(1);
  });

  // Test 2: No event anywhere contains an r-address, and tool events contain ONLY {name, phase, ok, refused?, ruleCode?}
  it("2. No event anywhere contains an r-address, and tool events contain ONLY {name, phase, ok, refused?, ruleCode?}", async () => {
    const { post } = setup({
      planner: [findKaroo, getRules, payKaroo, { text: "Paid Karoo $30." }],
    });

    const res = await post("/agent/chat", { message: "Pay Karoo $30 now" });
    const rawText = await res.text();
    const events = parseSSE(rawText);

    // No r-address or X-address anywhere in the output stream
    expect(rawText).not.toMatch(/\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/);
    expect(rawText).not.toMatch(/\b[XT][1-9A-HJ-NP-Za-km-z]{46}\b/);

    const toolEvents = events.filter((e) => e.event === "tool");
    expect(toolEvents.length).toBeGreaterThan(0);
    for (const te of toolEvents) {
      const actualKeys = Object.keys(te.data).sort();
      const expectedKeys = ["name", "phase", "ok"];
      if ("refused" in te.data) expectedKeys.push("refused");
      if ("ruleCode" in te.data) expectedKeys.push("ruleCode");
      expect(actualKeys).toEqual(expectedKeys.sort());

      // Assert no undefined values
      for (const [k, v] of Object.entries(te.data)) {
        expect(v).not.toBeUndefined();
      }
    }
  });

  // Tool events on refusal contain only {name, phase, ok, refused}
  it("2b. Refused tool event contains only {name, phase, ok: false, refused: true}", async () => {
    const payWrongAmount: ModelTurn = {
      toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "50.00", reason: "Wrong amount" } }],
    };
    const { post } = setup({
      planner: [findKaroo, payWrongAmount, { text: "Refused." }],
    });

    const res = await post("/agent/chat", { message: "Pay Karoo $30 now" });
    const events = parseSSE(await res.text());
    const payEnd = events.find((e) => e.event === "tool" && e.data.name === "pay" && e.data.phase === "end");
    expect(payEnd).toBeDefined();
    expect(payEnd?.data).toEqual({ name: "pay", phase: "end", ok: false, refused: true });
    expect(Object.keys(payEnd?.data).sort()).toEqual(["name", "ok", "phase", "refused"].sort());
  });

  // Test 3: Kill switch on -> exactly [summary, done]; the planner model has zero calls
  it("3. Kill switch on -> exactly [summary, done] and the planner model has zero calls", async () => {
    const { post, plannerModel } = setup({
      planner: [findKaroo, payKaroo, { text: "Done!" }],
      backend: { killSwitch: true },
    });

    const res = await post("/agent/chat", { message: "Pay Karoo $30 now" });
    expect(res.status).toBe(200);

    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual(["summary", "done"]);
    expect(events[0]!.data).toEqual({
      summary: "Blocked: the owner has revoked the agent's payment authority.",
      payments: [],
    });
    expect(events[1]).toEqual({ event: "done", data: {} });
    expect(plannerModel.calls).toHaveLength(0);
  });

  // Test 4: No token -> 401. Message of 2,001 chars -> 400
  it("4. No token -> 401. Message of 2,001 chars -> 400", async () => {
    const { post, plannerModel } = setup();

    const noToken = await post("/agent/chat", { message: "Pay Karoo $30 now" }, {});
    expect(noToken.status).toBe(401);
    expect(await errorCode(noToken)).toBe("unauthorized");
    expect(plannerModel.calls).toHaveLength(0);

    const wrongToken = await post("/agent/chat", { message: "Pay Karoo $30 now" }, { Authorization: "Bearer bad-token" });
    expect(wrongToken.status).toBe(401);
    expect(await errorCode(wrongToken)).toBe("unauthorized");
    expect(plannerModel.calls).toHaveLength(0);

    const over2000 = await post("/agent/chat", { message: "a".repeat(2001) });
    expect(over2000.status).toBe(400);
    expect(await errorCode(over2000)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);

    const empty = await post("/agent/chat", { message: "" });
    expect(empty.status).toBe(400);
    expect(await errorCode(empty)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);

    const extraField = await post("/agent/chat", { message: "hi", extra: "field" });
    expect(extraField.status).toBe(400);
    expect(await errorCode(extraField)).toBe("invalid_request");
    expect(plannerModel.calls).toHaveLength(0);
  });

  // Bad bodies: 413 over 1MB, 400 malformed JSON
  it("4b. 413 for body over 1 MB, 400 for malformed JSON", async () => {
    const { post, plannerModel } = setup();

    const over1MB = JSON.stringify({ message: "x".repeat(1024 * 1024) });
    const res413 = await post("/agent/chat", over1MB);
    expect(res413.status).toBe(413);
    expect(await errorCode(res413)).toBe("payload_too_large");
    expect(plannerModel.calls).toHaveLength(0);

    const res400 = await post("/agent/chat", '{"message": ');
    expect(res400.status).toBe(400);
    expect(await errorCode(res400)).toBe("invalid_json");
    expect(plannerModel.calls).toHaveLength(0);
  });

  // Test 5: A model that throws mid-stream -> an error event {message: "The agent could not finish."} then done
  it("5. A model that throws mid-stream -> error event {message: 'The agent could not finish.'} then done", async () => {
    const secretProviderError = "internal secret API key sk-ant-123456 quota exhausted at ModelRunner.stream (openai.ts:55)";
    const { post } = setup({
      planner: [findKaroo, { throws: new Error(secretProviderError) }],
    });

    const res = await post("/agent/chat", { message: "Pay Karoo $30 now" });
    expect(res.status).toBe(200);

    const rawText = await res.text();
    const events = parseSSE(rawText);

    const errorIndex = events.findIndex((e) => e.event === "error");
    expect(errorIndex).toBeGreaterThan(-1);
    expect(events[errorIndex]!.data).toEqual({ message: "The agent could not finish." });
    expect(events[errorIndex + 1]).toEqual({ event: "done", data: {} });

    // No stack trace or provider message leaked in SSE
    expect(rawText).not.toContain("sk-ant-123456");
    expect(rawText).not.toContain("openai.ts");
    expect(rawText).not.toContain("Error:");
    expect(rawText).not.toContain("ModelRunner");
  });

  // Test 6: An aborted request stops the run: the scripted model records no further calls after the abort
  it("6. An aborted request stops the run: the scripted model records no further calls after the abort", async () => {
    const controller = new AbortController();
    const { app, plannerModel } = setup({
      planner: [
        findKaroo,
        { delayMs: 150, then: getRules },
        payKaroo,
        { text: "Paid Karoo $30." },
      ],
    });

    const resPromise = app.request("/agent/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INBOUND_TOKEN}`,
      },
      body: JSON.stringify({ message: "Pay Karoo $30 now" }),
      signal: controller.signal,
    });

    // Abort shortly after the request starts
    setTimeout(() => {
      controller.abort();
    }, 40);

    try {
      const res = await resPromise;
      await res.text().catch(() => {});
    } catch {
      // AbortError is acceptable
    }

    // Wait past the delayMs of turn 1
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The planner should have recorded fewer calls than the full 4 turns
    expect(plannerModel.calls.length).toBeLessThan(3);
  });
});
