import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { backendClient } from "../src/backend";
import { DEFAULT_LIMITS, type RunLimits } from "../src/limits";
import { scriptedModel, type ModelTurn } from "./support/scripted-model";
import { AGENT_TOKEN, BACKEND_URL, fakeBackend } from "./support/fake-backend";
import { KAROO_FIELDS, KAROO_INVOICE } from "./support/invoices";

/**
 * T10 (G10): every backend and model call has a deadline, so a sleeping laptop or a hung backend
 * ends the run as needs_review in milliseconds here (seconds in production) instead of freezing it.
 * Limits are injected tiny; nothing waits for a real 10 s timeout.
 */
// Small enough to keep the file fast, big enough that the in-process work that must finish never trips them on a loaded CI runner.
const FAST: Partial<RunLimits> = { backendMs: 50, paymentMs: 50, modelMs: 150, runMs: 2_000 };

type Fake = ReturnType<typeof fakeBackend>;
type Fetch = typeof fetch;

/** The fake backend, except that `route` answers never. The request is still recorded (and, for a pay, executed). */
function hangOn(backend: Fake, route: string): Fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const response = await backend.fetch(input, init);
    const url = new URL(String(input));
    if (`${(init.method ?? "GET").toUpperCase()} ${url.pathname}` === route) return new Promise<never>(() => {});
    return response;
  }) as Fetch;
}

/** The fake backend, except that `route` answers with `response()`. The request is still recorded. */
function answerOn(backend: Fake, route: string, response: () => Response): Fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const answer = await backend.fetch(input, init);
    const url = new URL(String(input));
    return `${(init.method ?? "GET").toUpperCase()} ${url.pathname}` === route ? response() : answer;
  }) as Fetch;
}

function setup(opts: { planner: ModelTurn[]; extraction?: ModelTurn[]; limits?: Partial<RunLimits>; fetch?: (b: Fake) => Fetch; log?: unknown[] }) {
  const backend = fakeBackend({ log: opts.log });
  const extractionModel = scriptedModel(opts.extraction ?? [{ text: JSON.stringify(KAROO_FIELDS) }]);
  const plannerModel = scriptedModel(opts.planner);
  const agent = createAgent({
    extractionModel: extractionModel.model,
    plannerModel: plannerModel.model,
    backendUrl: BACKEND_URL,
    backendToken: AGENT_TOKEN,
    fetch: opts.fetch ? opts.fetch(backend) : backend.fetch,
    limits: opts.limits ?? FAST,
  });
  return { agent, backend, plannerModel, extractionModel };
}

const findKaroo: ModelTurn = { toolCalls: [{ tool: "find_supplier", input: { name: "Karoo Textiles" } }] };
const payKaroo: ModelTurn = {
  toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042", reason: "Cotton bolts" } }],
};
const queryLog: ModelTurn = { toolCalls: [{ tool: "query_log", input: {} }] };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await work;
  return { value, ms: performance.now() - start };
}

describe("limits: defaults", () => {
  it("defaults to the spec's numbers", () => {
    expect(DEFAULT_LIMITS).toEqual({
      backendMs: 10_000,
      paymentMs: 30_000,
      modelMs: 120_000,
      runMs: 300_000,
      maxBodyBytes: 262_144,
      maxLogEntries: 50,
    });
  });

  it("refuses a limit that is not a positive number", () => {
    const base = { extractionModel: scriptedModel([]).model, plannerModel: scriptedModel([]).model, backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN };
    expect(() => createAgent({ ...base, limits: { backendMs: 0 } })).toThrow(/backendMs/);
    expect(() => createAgent({ ...base, limits: { runMs: Number.NaN } })).toThrow(/runMs/);
  });
});

describe("limits: a hung backend fails closed and fast", () => {
  it("G10 probe: GET /rules never answers -> needs_review naming the stage, quickly", async () => {
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo], fetch: (b) => hangOn(b, "GET /rules") });

    const { value: outcome, ms } = await timed(agent.processInvoice(KAROO_INVOICE));

    expect(ms).toBeLessThan(500);
    expect(outcome).toMatchObject({ invoiceNumber: "INV-1042", decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/GET \/rules/);
    expect(outcome.explanation).toMatch(/did not answer/);
    expect(backend.payments).toHaveLength(0);
  });

  it("a hung GET /suppliers ends the run before the planner runs", async () => {
    const { agent, backend, plannerModel } = setup({ planner: [findKaroo, payKaroo], fetch: (b) => hangOn(b, "GET /suppliers") });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(outcome).toMatchObject({ decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/GET \/suppliers/);
    expect(plannerModel.calls).toHaveLength(0);
    expect(backend.payments).toHaveLength(0);
  });

  it("POST /payments never answers -> outcome unknown, check the activity log, sent exactly once", async () => {
    // The planner tries to pay again after the timeout; nothing may send a second request.
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo, payKaroo, payKaroo], fetch: (b) => hangOn(b, "POST /payments") });

    const outcome = await agent.processInvoice(KAROO_INVOICE);
    await sleep(100); // anything still running in the background has had time to try again

    expect(outcome).toMatchObject({ invoiceNumber: "INV-1042", decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/payment outcome is unknown/i);
    expect(outcome.explanation).toMatch(/check the activity log/i);
    expect(outcome.explanation).toMatch(/not retried/i);
    expect(outcome.txHash).toBeUndefined();
    expect(backend.payments).toHaveLength(1);
  });

  it("a pay cut off by the run deadline is also outcome unknown, never 'no payment was made'", async () => {
    const { agent, backend } = setup({
      planner: [findKaroo, payKaroo],
      limits: { ...FAST, paymentMs: 10_000, modelMs: 10_000, runMs: 200 },
      fetch: (b) => hangOn(b, "POST /payments"),
    });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(outcome.decision).toBe("needs_review");
    expect(outcome.explanation).toMatch(/payment outcome is unknown/i);
    expect(outcome.explanation).not.toMatch(/no payment was made/i);
    expect(backend.payments).toHaveLength(1);
  });

  it("a standalone client tells its caller a hung pay's outcome is unknown, and sends it once", async () => {
    const backend = fakeBackend();
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: hangOn(backend, "POST /payments"), limits: { paymentMs: 20 } });

    const reply = await client.pay({ supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042", reason: "Cotton bolts" });

    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/outcome is unknown.*not retried.*activity log/i) });
    expect(backend.payments).toHaveLength(1);
  });

  it("chat: a hung pay is reported as outcome unknown and not retried", async () => {
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo, payKaroo], fetch: (b) => hangOn(b, "POST /payments") });

    const answer = await agent.chat("Pay Karoo 30.00 for INV-1042 now");
    await sleep(100);

    expect(answer.reply).toMatch(/outcome is unknown/i);
    expect(answer.reply).toMatch(/activity log/i);
    expect(answer.payments).toEqual([]);
    expect(backend.payments).toHaveLength(1);
  });

  it("chat: a hung GET /rules gives a reply naming the stage, quickly", async () => {
    const { agent } = setup({ planner: [{ text: "hello" }], fetch: (b) => hangOn(b, "GET /rules") });

    const { value: answer, ms } = await timed(agent.chat("How much budget is left?"));

    expect(ms).toBeLessThan(500);
    expect(answer.reply).toMatch(/GET \/rules/);
    expect(answer.payments).toEqual([]);
  });
});

describe("limits: a payment whose answer can't be trusted is outcome unknown", () => {
  const settledButHuge = () =>
    new Response(JSON.stringify({ status: "settled", ruleCode: "OK", txHash: "TXBIG", logId: "log_1", pad: "x".repeat(300_000) }), { status: 200 });
  const breaksMidBody = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"status":"settled","ruleCode":"OK",'));
          controller.error(new TypeError("connection reset"));
        },
      }),
      { status: 200 },
    );
  const notJson = () => new Response("<html>OK</html>", { status: 200 });
  const offContract = () => Response.json({ status: "settled", ruleCode: "OK", logId: "log_1" }); // settled without a tx hash
  const badGateway = () => Response.json({ error: "bad gateway" }, { status: 502 });
  const gatewayTimeout = () => new Response("", { status: 504 });

  const cases: Array<[string, (b: Fake) => Fetch]> = [
    ["a 2xx body over maxBodyBytes", (b) => answerOn(b, "POST /payments", settledButHuge)],
    ["a 2xx body that errors mid-read", (b) => answerOn(b, "POST /payments", breaksMidBody)],
    ["a 2xx body that is not JSON", (b) => answerOn(b, "POST /payments", notJson)],
    ["a 2xx body that fails PayResult", (b) => answerOn(b, "POST /payments", offContract)],
    ["a 502", (b) => answerOn(b, "POST /payments", badGateway)],
    ["a 504", (b) => answerOn(b, "POST /payments", gatewayTimeout)],
    ["a 400 with an error body", (b) => answerOn(b, "POST /payments", () => Response.json({ error: "bad request" }, { status: 400 }))],
    [
      "a 409 with a settled body",
      (b) => answerOn(b, "POST /payments", () => Response.json({ status: "settled", ruleCode: "OK", txHash: "TX4", logId: "log_1" }, { status: 409 })),
    ],
    [
      "a network error after the request was sent",
      (b) =>
        (async (input: string | URL | Request, init: RequestInit = {}) => {
          const answer = await b.fetch(input, init);
          if (new URL(String(input)).pathname === "/payments") throw new TypeError("fetch failed");
          return answer;
        }) as Fetch,
    ],
  ];

  it.each(cases)("processInvoice: %s -> outcome unknown, sent once, never 'No payment was made'", async (_name, fetch) => {
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo, payKaroo, payKaroo], fetch });

    const outcome = await agent.processInvoice(KAROO_INVOICE);
    await sleep(50);

    expect(backend.payments).toHaveLength(1);
    expect(outcome).toMatchObject({ decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/payment outcome is unknown/i);
    expect(outcome.explanation).toMatch(/check the activity log/i);
    expect(outcome.explanation).not.toMatch(/no payment was made/i);
    expect(outcome.txHash).toBeUndefined();
  });

  it.each(cases)("chat: %s -> outcome unknown, sent once", async (_name, fetch) => {
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo, payKaroo], fetch });

    const answer = await agent.chat("Pay Karoo 30.00 for INV-1042 now");
    await sleep(50);

    expect(backend.payments).toHaveLength(1);
    expect(answer.reply).toMatch(/outcome is unknown/i);
    expect(answer.reply).not.toMatch(/no payment was made|nothing further was done/i);
  });

  it("a standalone client reports an unreadable pay answer as outcome unknown", async () => {
    const backend = fakeBackend();
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: answerOn(backend, "POST /payments", notJson) });

    const reply = await client.pay({ supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042", reason: "Cotton bolts" });

    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/outcome is unknown/i) });
  });

  it("a 4xx with a valid refusal body stays a refusal, reported with its rule code", async () => {
    const refusal = () => Response.json({ status: "blocked", ruleCode: "OVER_BUDGET", logId: "log_1" }, { status: 409 });
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo], fetch: (b) => answerOn(b, "POST /payments", refusal) });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(backend.payments).toHaveLength(1);
    expect(outcome).toMatchObject({ decision: "blocked", ruleCode: "OVER_BUDGET" });
  });

  it("a valid 2xx answer is still a normal, known result", async () => {
    const { agent } = setup({ planner: [findKaroo, payKaroo, { text: "Paid." }] });
    expect(await agent.processInvoice(KAROO_INVOICE)).toMatchObject({ decision: "paid", txHash: "TXHASH1" });
  });

  it("chat: a payment that settled before a stall is reported as gone through, with its tx hash", async () => {
    const { agent } = setup({ planner: [findKaroo, payKaroo, { hang: true }] });

    const answer = await agent.chat("Pay Karoo 30.00 for INV-1042 now");

    expect(answer.payments).toMatchObject([{ status: "settled", txHash: "TXHASH1" }]);
    expect(answer.reply).toMatch(/went through/);
    expect(answer.reply).toContain("TXHASH1");
    expect(answer.reply).not.toMatch(/nothing further was done/i);
  });
});

describe("limits: response size", () => {
  const CANARY = "OVERSIZE-CANARY-41c9";
  const bigLog = () => JSON.stringify(Array.from({ length: 3_000 }, (_, i) => ({ seq: i, note: `${CANARY} ${"x".repeat(80)}` })));

  it("a 300 KB GET /log body is a backend error and none of it reaches the model", async () => {
    const body = bigLog();
    expect(body.length).toBeGreaterThan(300_000);
    const { agent, plannerModel } = setup({
      planner: [queryLog, { text: "I could not read the log." }],
      fetch: (b) => answerOn(b, "GET /log", () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })),
    });

    await agent.chat("Did I pay Karoo this month?");

    expect(plannerModel.calls).toHaveLength(2);
    expect(plannerModel.everythingTheModelSaw).not.toContain(CANARY);
    expect(plannerModel.everythingTheModelSaw).toMatch(/too large/);
  });

  it("an endless body is cut off after the limit, never buffered whole", async () => {
    let pulled = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            controller.enqueue(new TextEncoder().encode(`"${"y".repeat(1022)}",`));
          },
        }),
        { status: 200 },
      );
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: answerOn(fakeBackend(), "GET /log", endless), limits: { maxBodyBytes: 4_096 } });

    const reply = await client.queryLog({});

    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
    expect(pulled).toBeLessThan(10);
  });

  it("a declared Content-Length over the limit is refused without reading the body", async () => {
    let pulled = 0;
    const declared = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            controller.enqueue(new TextEncoder().encode("[]"));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Length": "999999" } },
      );
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: answerOn(fakeBackend(), "GET /rules", declared) });

    expect(await client.getRules()).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
    expect(pulled).toBeLessThanOrEqual(1); // a stream may pre-pull one chunk; it is never read
  });

  it("a body just under the limit still parses", async () => {
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: fakeBackend().fetch, limits: { maxBodyBytes: 4_096 } });
    expect(await client.getRules()).toMatchObject({ ok: true, body: { killSwitch: false } });
  });

  it("GET /log with 80 entries -> the model sees at most 50", async () => {
    const log = Array.from({ length: 80 }, (_, i) => ({ seq: i + 1, event: "payment_settled", note: `LOGROW-${i + 1}-END` }));
    const { agent, plannerModel } = setup({ planner: [queryLog, { text: "Here is the log." }], log });

    await agent.chat("Show me the log");

    // T07: query_log shows the model no free text (the note is dropped), so count the entries by seq.
    const seen = [...plannerModel.everythingTheModelSaw.matchAll(/"seq":(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(seen).size).toBe(50);
    expect(seen).toContain(50);
    expect(seen).not.toContain(51);
  });

  it("an off-contract GET /log reply (not a list) is refused", async () => {
    const client = backendClient({
      backendUrl: BACKEND_URL,
      backendToken: AGENT_TOKEN,
      fetch: answerOn(fakeBackend(), "GET /log", () => Response.json({ entries: ["LEAK-ME"] })),
    });
    expect(await client.queryLog({})).toEqual({ ok: false, error: expect.stringMatching(/not a list/) });
  });
});

describe("limits: redirects", () => {
  type Seen = { method: string; url: string; headers: IncomingHttpHeaders };
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("a 302 to another host is refused and the target never sees a request (so never the token)", async () => {
    const seenByTarget: Seen[] = [];
    const target = await listen((req, res) => {
      seenByTarget.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ killSwitch: false, perPaymentCap: "50.00" }));
    });
    const redirector = await listen((req, res) => res.writeHead(302, { Location: `${target}${req.url}` }).end());

    // Real fetch, real sockets: this is the behaviour of the fetch the agent ships with.
    const client = backendClient({ backendUrl: redirector, backendToken: AGENT_TOKEN });
    const reply = await client.getRules();

    expect(reply.ok).toBe(false);
    expect(seenByTarget).toEqual([]);
  });

  it("processInvoice behind a redirecting backend ends as needs_review with no payment", async () => {
    const seenByTarget: Seen[] = [];
    const target = await listen((req, res) => {
      seenByTarget.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
      res.writeHead(200).end("{}");
    });
    const redirector = await listen((req, res) => res.writeHead(307, { Location: `${target}${req.url}` }).end());
    const agent = createAgent({
      extractionModel: scriptedModel([{ text: JSON.stringify(KAROO_FIELDS) }]).model,
      plannerModel: scriptedModel([findKaroo, payKaroo]).model,
      backendUrl: redirector,
      backendToken: AGENT_TOKEN,
      limits: FAST,
    });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(outcome.decision).toBe("needs_review");
    expect(seenByTarget).toEqual([]);
  });
});

describe("limits: a hung model fails closed and fast", () => {
  it("the extraction model never answers -> needs_review, nothing sent to the backend", async () => {
    const { agent, backend } = setup({ extraction: [{ hang: true }], planner: [findKaroo, payKaroo] });

    const { value: outcome, ms } = await timed(agent.processInvoice(KAROO_INVOICE));

    expect(ms).toBeLessThan(500);
    expect(outcome).toMatchObject({ invoiceNumber: null, decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/invoice extraction/i);
    expect(backend.requests).toEqual([]);
  });

  it("the planner never answers -> needs_review naming the planner, zero payments", async () => {
    const { agent, backend } = setup({ planner: [{ hang: true }] });

    const { value: outcome, ms } = await timed(agent.processInvoice(KAROO_INVOICE));

    expect(ms).toBeLessThan(500);
    expect(outcome).toMatchObject({ invoiceNumber: "INV-1042", decision: "needs_review", ruleCode: null });
    expect(outcome.explanation).toMatch(/planner/);
    expect(outcome.explanation).toMatch(/No payment was made/);
    expect(backend.payments).toHaveLength(0);
  });

  it("a planner that answers after its deadline cannot pay: the late tool call never reaches the backend", async () => {
    const { agent, backend } = setup({ planner: [findKaroo, { delayMs: 300, then: payKaroo }] });

    const outcome = await agent.processInvoice(KAROO_INVOICE);
    await sleep(400); // the late answer arrives and its tool call runs in the background

    expect(outcome.decision).toBe("needs_review");
    expect(backend.payments).toHaveLength(0);
  });

  it("the run deadline stops a slow run even when each call is within its own limit", async () => {
    const { agent, backend, plannerModel } = setup({
      planner: [{ delayMs: 30, then: findKaroo }, { delayMs: 30, then: findKaroo }, { delayMs: 30, then: payKaroo }],
      limits: { ...FAST, modelMs: 1_000, runMs: 50 },
    });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(outcome.decision).toBe("needs_review");
    expect(outcome.explanation).toMatch(/deadline/);
    // The deadline cancels the model call itself, not just our wait for it.
    expect(plannerModel.calls.at(-1)?.abortSignal?.aborted).toBe(true);
    await sleep(100);
    expect(backend.payments).toHaveLength(0);
  });

  it("a payment that settled before the planner hung is still reported as paid, with its tx hash", async () => {
    const { agent, backend } = setup({ planner: [findKaroo, payKaroo, { hang: true }] });

    const outcome = await agent.processInvoice(KAROO_INVOICE);

    expect(backend.payments).toHaveLength(1);
    expect(outcome).toMatchObject({ decision: "paid", ruleCode: "OK", txHash: "TXHASH1" });
  });

  it("chat: a planner that never answers gives a reply naming the planner", async () => {
    const { agent, backend } = setup({ planner: [{ hang: true }] });

    const answer = await agent.chat("Did I pay Karoo?");

    expect(answer.reply).toMatch(/planner/);
    expect(backend.payments).toHaveLength(0);
  });

  it("passes an abort signal to the model calls", async () => {
    const { agent, plannerModel, extractionModel } = setup({ planner: [{ text: "Nothing to do." }] });

    await agent.processInvoice(KAROO_INVOICE);

    expect(extractionModel.calls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(plannerModel.calls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe("limits: every backend request is sent with a deadline and redirect: error", () => {
  it("sets signal and redirect on each fetch", async () => {
    const inits: RequestInit[] = [];
    const backend = fakeBackend();
    const spy = (async (input: string | URL | Request, init: RequestInit = {}) => {
      inits.push(init);
      return backend.fetch(input, init);
    }) as Fetch;
    const client = backendClient({ backendUrl: BACKEND_URL, backendToken: AGENT_TOKEN, fetch: spy });

    await client.getRules();
    await client.findSupplier("Karoo");
    await client.queryLog({});

    expect(inits).toHaveLength(3);
    for (const init of inits) {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
