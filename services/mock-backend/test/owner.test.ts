import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInvoiceId, OwnerState } from "@shucamoxa/shared";
import { DEMO_SEED, loadMockConfig, mockSupplierAddress } from "../src/index";
import { AGENT_TOKEN, INBOUND_TOKEN, MOCK_ENV, OWNER_TOKEN, pay, startTestBackend, type TestBackend } from "./support/backend";
import { json, PAID_RESPONSE, startFakeAgent } from "./support/fake-agent";

let backend: TestBackend;
let agent: Awaited<ReturnType<typeof startFakeAgent>> | undefined;
afterEach(async () => {
  const started = backend as TestBackend | undefined;
  backend = undefined!; // a test that starts no backend must not close the previous one twice
  await started?.close();
  await agent?.close();
  agent = undefined;
});

const OWNER_API_ROUTES: ReadonlyArray<readonly [string, string, unknown]> = [
  ["GET", "/owner/api/state", undefined],
  ["GET", "/owner/api/demo-invoices/01", undefined],
  ["POST", "/owner/api/kill-switch", { on: true }],
  ["PUT", "/owner/api/limits", { perPaymentCap: "999.00", totalBudget: "9999.00" }],
  ["POST", "/owner/api/approvals/appr_x", { decision: "approve" }],
  ["POST", "/owner/api/invoices", { text: "Invoice INV-1 from Karoo Textiles, total 1.00 USD" }],
];
const STATE_CHANGING = OWNER_API_ROUTES.filter(([method]) => method !== "GET");

const paymentApproval = { kind: "payment", payload: { invoiceNumber: "INV-2001", supplierId: "sup_karoo", amount: "120", reason: "Over the per-payment cap" } };
const supplierProposal = {
  kind: "supplier",
  payload: { name: "Atlas Freight", address: mockSupplierAddress("sup_atlas"), evidence: "Invoice INV-3301 names Atlas Freight", invoiceNumber: "INV-3301" },
};

async function withAgent(options: { agentTimeoutMs?: number } = {}) {
  agent = await startFakeAgent();
  backend = await startTestBackend({ env: { ...MOCK_ENV, AGENT_URL: agent.url, AGENT_INBOUND_TOKEN: INBOUND_TOKEN }, ...options });
  return agent;
}

describe("owner login", () => {
  it("GET /owner without a session shows the token form, under a strict CSP", async () => {
    backend = await startTestBackend();
    const page = await backend.raw("GET", "/owner");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(page.text).toContain('data-view="login"');
    expect(page.text).toContain('id="login-form"');
    const csp = page.headers.get("content-security-policy") ?? "";
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(directive);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("GET /owner with a session shows the dashboard", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    const page = await owner("GET", "/owner");
    expect(page.text).toContain('data-view="dashboard"');
  });

  it("sets an httpOnly, SameSite=Strict, Path=/owner cookie holding a random session ID, never the token", async () => {
    backend = await startTestBackend();
    const a = await backend.ownerSession();
    const b = await backend.ownerSession();
    const setCookie = a.login.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/owner(;|$)/);
    const value = a.cookie.split("=")[1] ?? "";
    expect(value.length).toBeGreaterThanOrEqual(32);
    expect(a.cookie).not.toContain(OWNER_TOKEN);
    expect(a.login.text).not.toContain(OWNER_TOKEN);
    expect(a.cookie).not.toBe(b.cookie);
  });

  it.each([
    ["a wrong token of the same length", OWNER_TOKEN.replace(/.$/, "X")],
    ["a prefix of the token", OWNER_TOKEN.slice(0, 10)],
    ["the token with a suffix", `${OWNER_TOKEN}x`],
    ["the agent token", AGENT_TOKEN],
    ["an empty token", ""],
  ])("refuses %s with 401 and no cookie", async (_name, token) => {
    backend = await startTestBackend();
    const res = await backend.raw("POST", "/owner/login", { Origin: backend.origin }, { token });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.text).not.toContain(OWNER_TOKEN);
  });

  it("refuses a cross-origin or Origin-less login with 403", async () => {
    backend = await startTestBackend();
    expect((await backend.raw("POST", "/owner/login", { Origin: "http://evil.example" }, { token: OWNER_TOKEN })).status).toBe(403);
    const bare = await backend.raw("POST", "/owner/login", {}, { token: OWNER_TOKEN });
    expect(bare.status).toBe(403);
    expect(bare.headers.get("set-cookie")).toBeNull();
  });

  it("logout ends the session", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    expect((await owner("GET", "/owner/api/state")).status).toBe(200);
    const out = await owner("POST", "/owner/logout");
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await owner("GET", "/owner/api/state")).status).toBe(401);
  });
});

describe("owner API auth", () => {
  it.each(OWNER_API_ROUTES)("%s %s without a session is 401", async (method, path, body) => {
    backend = await startTestBackend();
    expect((await backend.raw(method, path, { Origin: backend.origin }, body)).status).toBe(401);
  });

  it.each(OWNER_API_ROUTES)("%s %s with a forged session cookie is 401", async (method, path, body) => {
    backend = await startTestBackend();
    expect((await backend.raw(method, path, { Origin: backend.origin, Cookie: `pg_owner=${"A".repeat(43)}` }, body)).status).toBe(401);
  });

  it.each(OWNER_API_ROUTES)("%s %s with the agent token (or the owner token as a bearer) is 401", async (method, path, body) => {
    backend = await startTestBackend();
    for (const token of [AGENT_TOKEN, OWNER_TOKEN]) {
      expect((await backend.raw(method, path, { Origin: backend.origin, Authorization: `Bearer ${token}` }, body)).status).toBe(401);
    }
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ killSwitch: false, perPaymentCap: "50.00" });
  });

  it.each(STATE_CHANGING)("%s %s cross-origin or with no Origin is 403 and changes nothing", async (method, path, body) => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    for (const origin of ["http://evil.example", "null", `${backend.origin}.evil.example`]) {
      expect((await backend.raw(method, path, { Cookie: owner.cookie, Origin: origin }, body)).status).toBe(403);
    }
    expect((await backend.raw(method, path, { Cookie: owner.cookie }, body)).status).toBe(403);
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ killSwitch: false, perPaymentCap: "50.00" });
    expect((await backend.agent("GET", "/log")).json).toEqual([]);
  });

  it("refuses the owner session on agent routes with 401", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    for (const [method, path, body] of [
      ["GET", "/rules", undefined],
      ["GET", "/log", undefined],
      ["POST", "/payments", pay("INV-1", "1.00")],
      ["POST", "/approvals", paymentApproval],
    ] as const) {
      expect((await owner(method, path, body)).status).toBe(401);
    }
    expect((await backend.agent("GET", "/log")).json).toEqual([]);
  });
});

describe("GET /owner/api/state", () => {
  it("returns rules, kill switch, suppliers with short addresses, approvals and activity", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/payments", pay("INV-1", "30.00"));
    await backend.agent("POST", "/payments", pay("INV-2", "60.00"));
    await backend.agent("POST", "/approvals", paymentApproval);
    const owner = await backend.ownerSession();
    const res = await owner("GET", "/owner/api/state");
    expect(res.status).toBe(200);
    const state = OwnerState.parse(res.json);
    expect(state.rules).toEqual({ perPaymentCap: "50.00", totalBudget: "200.00", spent: "30.00", reserved: "0.00", remaining: "170.00", periodStart: "2026-11-01" });
    expect(state.killSwitch).toBe(false);
    const karoo = DEMO_SEED.suppliers[0]!.address;
    expect(state.suppliers[0]).toEqual({ id: "sup_karoo", name: "Karoo Textiles", shortAddress: `${karoo.slice(0, 6)}…${karoo.slice(-4)}` });
    expect(res.text).not.toContain(karoo);
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]).toMatchObject({ kind: "payment", invoiceNumber: "INV-2001", supplierId: "sup_karoo", supplierName: "Karoo Textiles", amount: "120.00" });
    expect(state.activity.map((r) => r.event)).toEqual(["approval_requested", "policy_blocked", "payment_settled"]);
    expect(state.activity[2]).toMatchObject({ supplierName: "Karoo Textiles", amount: "30.00", ruleCode: "OK" });
    // Mock mode: the hash is a mock one and there is no explorer link to follow.
    expect(state.activity[2]!.txHash).toMatch(/^[0-9A-F]{64}$/);
    expect(state.activity[2]!.explorerUrl).toBeUndefined();
  });

  it("shows only a shortened address for a supplier proposal", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/approvals", supplierProposal);
    const owner = await backend.ownerSession();
    const res = await owner("GET", "/owner/api/state");
    expect(res.json.approvals[0]).toMatchObject({ kind: "supplier", supplierName: "Atlas Freight", supplierId: null, amount: null });
    expect(res.json.approvals[0].shortAddress).toMatch(/…/);
    expect(res.text).not.toContain(supplierProposal.payload.address);
  });

  it("returns at most 50 activity rows, newest first", async () => {
    backend = await startTestBackend();
    for (let i = 1; i <= 55; i++) await backend.agent("POST", "/payments", pay(`INV-${i}`, "500.00"));
    const owner = await backend.ownerSession();
    const { activity } = (await owner("GET", "/owner/api/state")).json;
    expect(activity).toHaveLength(50);
    expect(activity[0].invoiceNumber).toBe("INV-55");
    expect(activity[0].seq).toBeGreaterThan(activity[1].seq);
  });
});

describe("POST /owner/api/kill-switch", () => {
  it("on: the agent's /rules shows it and /payments blocks with KILL_SWITCH_ON", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    expect((await owner("POST", "/owner/api/kill-switch", { on: true })).json).toEqual({ killSwitch: true });
    expect((await backend.agent("GET", "/rules")).json.killSwitch).toBe(true);
    expect((await backend.agent("POST", "/payments", pay("INV-1044", "10.00"))).json).toMatchObject({ status: "blocked", ruleCode: "KILL_SWITCH_ON" });
    expect((await owner("GET", "/owner/api/state")).json.killSwitch).toBe(true);
  });
});

describe("PUT /owner/api/limits", () => {
  it("lowering the cap makes the next over-cap payment block, and logs the change", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    const res = await owner("PUT", "/owner/api/limits", { perPaymentCap: "20", totalBudget: "150.5" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ perPaymentCap: "20.00", totalBudget: "150.50" });
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ perPaymentCap: "20.00", totalBudget: "150.50", remaining: "150.50" });
    expect((await backend.agent("POST", "/payments", pay("INV-1", "30.00"))).json).toMatchObject({ status: "blocked", ruleCode: "OVER_PER_PAYMENT_CAP" });
    const log = (await backend.agent("GET", "/log")).json;
    expect(log.at(-1)).toMatchObject({ actor: "owner", event: "rules_changed" });
  });

  it("refuses a budget below spent + reserved with 409 and keeps the old limits", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/payments", pay("INV-1", "30.00"));
    await backend.agent("POST", "/payments", pay("INV-2", "40.00"));
    const owner = await backend.ownerSession();
    const refused = await owner("PUT", "/owner/api/limits", { perPaymentCap: "50.00", totalBudget: "69.99" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toMatch(/spent/);
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ totalBudget: "200.00", spent: "70.00" });
    const exact = await owner("PUT", "/owner/api/limits", { perPaymentCap: "50.00", totalBudget: "70.00" });
    expect(exact.status).toBe(200);
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ totalBudget: "70.00", remaining: "0.00" });
  });

  it.each([
    { perPaymentCap: "0", totalBudget: "100.00" },
    { perPaymentCap: "10.00", totalBudget: "0.00" },
    { perPaymentCap: "-5", totalBudget: "100.00" },
    { perPaymentCap: 10, totalBudget: "100.00" },
    { perPaymentCap: "1e3", totalBudget: "100.00" },
    { perPaymentCap: "10.001", totalBudget: "100.00" },
    { perPaymentCap: "10.00" },
    { perPaymentCap: "10.00", totalBudget: "100.00", killSwitch: false },
  ])("refuses %j with 400", async (body) => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    expect((await owner("PUT", "/owner/api/limits", body)).status).toBe(400);
    expect((await backend.agent("GET", "/rules")).json).toMatchObject({ perPaymentCap: "50.00", totalBudget: "200.00" });
  });
});

describe("POST /owner/api/approvals/:id", () => {
  it("records the decision and marks the approval, without paying or adding a supplier", async () => {
    backend = await startTestBackend();
    const pending = (await backend.agent("POST", "/approvals", paymentApproval)).json.approvalId;
    const proposal = (await backend.agent("POST", "/approvals", supplierProposal)).json.approvalId;
    const owner = await backend.ownerSession();
    const approved = await owner("POST", `/owner/api/approvals/${pending}`, { decision: "approve" });
    expect(approved).toMatchObject({ status: 200, json: { approvalId: pending, status: "approved" } });
    expect((await owner("POST", `/owner/api/approvals/${proposal}`, { decision: "approve" })).json.status).toBe("approved");

    const state = (await owner("GET", "/owner/api/state")).json;
    expect(state.approvals).toEqual([]);
    expect(state.rules.spent).toBe("0.00");
    expect(state.suppliers.map((s: { id: string }) => s.id)).toEqual(["sup_karoo", "sup_zambezi"]);
    const events = (await backend.agent("GET", "/log")).json.map((e: { actor: string; event: string }) => `${e.actor}:${e.event}`);
    expect(events).toEqual(["owner:approval_decided", "owner:approval_decided", "agent:approval_requested", "agent:approval_requested"]);
    expect(events.some((e: string) => e.endsWith("payment_settled"))).toBe(false);
    expect((await backend.agent("GET", "/rules")).json.suppliers).toHaveLength(2);
    const lines = readFileSync(backend.approvalsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ approvalId: proposal, status: "approved" });
  });

  it("records a rejection", async () => {
    backend = await startTestBackend();
    const id = (await backend.agent("POST", "/approvals", paymentApproval)).json.approvalId;
    const owner = await backend.ownerSession();
    expect((await owner("POST", `/owner/api/approvals/${id}`, { decision: "reject" })).json.status).toBe("rejected");
    expect((await backend.agent("GET", "/log")).json[0]).toMatchObject({ actor: "owner", event: "approval_decided", invoiceNumber: "INV-2001" });
  });

  it("is 404 for an unknown approval, 409 for a decided one and 400 for a bad decision", async () => {
    backend = await startTestBackend();
    const id = (await backend.agent("POST", "/approvals", paymentApproval)).json.approvalId;
    const owner = await backend.ownerSession();
    expect((await owner("POST", "/owner/api/approvals/appr_nope", { decision: "approve" })).status).toBe(404);
    expect((await owner("POST", `/owner/api/approvals/${id}`, { decision: "maybe" })).status).toBe(400);
    expect((await owner("POST", `/owner/api/approvals/${id}`, { decision: "approve", pay: true })).status).toBe(400);
    expect((await owner("POST", `/owner/api/approvals/${id}`, { decision: "reject" })).status).toBe(200);
    expect((await owner("POST", `/owner/api/approvals/${id}`, { decision: "approve" })).status).toBe(409);
  });
});

describe("POST /owner/api/invoices (proxy to the agent)", () => {
  const text = "Invoice INV-1042 from Karoo Textiles, total 30.00 USD";

  it("forwards the text with the inbound token and a fresh invoiceId, and returns the agent's outcome", async () => {
    const fake = await withAgent();
    const owner = await backend.ownerSession();
    const a = await owner("POST", "/owner/api/invoices", { text });
    const b = await owner("POST", "/owner/api/invoices", { text });
    expect(a.status).toBe(200);
    expect(a.json).toEqual({ outcome: PAID_RESPONSE.outcome });
    expect(b.status).toBe(200);
    expect(fake.requests).toHaveLength(2);
    const [first, second] = fake.requests.map((r) => ({ ...r, json: JSON.parse(r.body) }));
    expect(first).toMatchObject({ method: "POST", path: "/agent/invoices", authorization: `Bearer ${INBOUND_TOKEN}`, json: { text } });
    expect(Object.keys(first!.json).sort()).toEqual(["invoiceId", "text"]);
    expect(AgentInvoiceId.safeParse(first!.json.invoiceId).success).toBe(true);
    expect(first!.json.invoiceId).not.toBe(second!.json.invoiceId);
    for (const r of [a, b]) expect(r.text).not.toContain(INBOUND_TOKEN);
    for (const r of fake.requests) {
      expect(r.body).not.toContain(OWNER_TOKEN);
      expect(r.body).not.toContain(AGENT_TOKEN);
    }
  });

  it("maps an agent timeout to a clear 504", async () => {
    const fake = await withAgent({ agentTimeoutMs: 150 });
    fake.respond(() => undefined); // never answers
    const owner = await backend.ownerSession();
    const res = await owner("POST", "/owner/api/invoices", { text });
    expect(res.status).toBe(504);
    expect(res.json.error).toMatch(/agent did not answer/i);
  });

  it("caps the body at 20 KB and forwards nothing", async () => {
    const fake = await withAgent();
    const owner = await backend.ownerSession();
    const res = await owner("POST", "/owner/api/invoices", { text: "x".repeat(20 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(fake.requests).toHaveLength(0);
    expect((await owner("POST", "/owner/api/invoices", { text: "x".repeat(20_000) })).status).toBe(200);
  });

  it("is 400 for an empty or off-contract body and forwards nothing", async () => {
    const fake = await withAgent();
    const owner = await backend.ownerSession();
    expect((await owner("POST", "/owner/api/invoices", { text: "" })).status).toBe(400);
    expect((await owner("POST", "/owner/api/invoices", { text, invoiceId: "mine" })).status).toBe(400);
    expect((await owner("POST", "/owner/api/invoices", "not json")).status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it("maps an off-contract or failed agent answer to 502, and an in-flight invoice to 409", async () => {
    const fake = await withAgent();
    const owner = await backend.ownerSession();
    fake.respond((_req, res) => json(res, 200, { outcome: { ...PAID_RESPONSE.outcome, address: "rLeak" }, explanation: PAID_RESPONSE.explanation }));
    expect((await owner("POST", "/owner/api/invoices", { text })).status).toBe(502);
    fake.respond((_req, res) => json(res, 500, { error: "internal_error", message: "The agent could not finish this request." }));
    expect((await owner("POST", "/owner/api/invoices", { text })).status).toBe(502);
    fake.respond((_req, res) => json(res, 409, { error: "invoice_in_flight", message: "This invoice is already being processed." }));
    expect((await owner("POST", "/owner/api/invoices", { text })).status).toBe(409);
    fake.respond((_req, res) => {
      res.writeHead(302, { Location: "http://127.0.0.1:1/elsewhere" });
      res.end();
    });
    expect((await owner("POST", "/owner/api/invoices", { text })).status).toBe(502);
  });

  it("is 502 when the agent is unreachable and 503 when it isn't configured", async () => {
    backend = await startTestBackend({ env: { ...MOCK_ENV, AGENT_URL: "http://127.0.0.1:1", AGENT_INBOUND_TOKEN: INBOUND_TOKEN } });
    let owner = await backend.ownerSession();
    const down = await owner("POST", "/owner/api/invoices", { text });
    expect(down.status).toBe(502);
    expect(down.json.error).toMatch(/agent is unreachable/i);
    await backend.close();
    backend = await startTestBackend();
    owner = await backend.ownerSession();
    expect((await owner("POST", "/owner/api/invoices", { text })).status).toBe(503);
  });
});

describe("demo invoices", () => {
  it("serves invoices 01-06 read-only from fixtures/invoices, to the owner session only", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    const res = await owner("GET", "/owner/api/demo-invoices/01");
    expect(res.status).toBe(200);
    const file = readFileSync(new URL("../../../fixtures/invoices/01-karoo-valid.txt", import.meta.url), "utf8");
    expect(res.json).toEqual({ id: "01", name: "01-karoo-valid.txt", text: file });
    expect((await owner("GET", "/owner/api/demo-invoices/06")).status).toBe(200);
    for (const id of ["07", "00", "..%2Fexpected.json", "01-karoo-valid.txt"]) expect((await owner("GET", `/owner/api/demo-invoices/${id}`)).status).toBe(404);
    expect((await owner("PUT", "/owner/api/demo-invoices/01", { text: "x" })).status).toBe(404);
  });
});

describe("static dashboard files", () => {
  it("serves the script and stylesheet with their types and the CSP", async () => {
    backend = await startTestBackend();
    const js = await backend.raw("GET", "/owner/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(js.headers.get("content-security-policy")).toContain("script-src 'self'");
    const css = await backend.raw("GET", "/owner/app.css");
    expect(css.headers.get("content-type")).toMatch(/^text\/css/);
    expect((await backend.raw("GET", "/owner/server.ts")).status).toBe(404);
    expect((await backend.raw("GET", "/owner/index.html")).status).toBe(404);
  });
});

describe("agent proxy config", () => {
  it.each([
    [{ AGENT_URL: "http://127.0.0.1:8790" }, /AGENT_INBOUND_TOKEN/],
    [{ AGENT_INBOUND_TOKEN: INBOUND_TOKEN }, /AGENT_URL/],
    [{ AGENT_URL: "http://127.0.0.1:8790", AGENT_INBOUND_TOKEN: "short-inbound" }, /AGENT_INBOUND_TOKEN/],
    [{ AGENT_URL: "http://127.0.0.1:8790", AGENT_INBOUND_TOKEN: OWNER_TOKEN }, /AGENT_INBOUND_TOKEN/],
    [{ AGENT_URL: "http://example.com:8790", AGENT_INBOUND_TOKEN: INBOUND_TOKEN }, /AGENT_URL/],
    [{ AGENT_URL: "http://127.0.0.1:8790/agent", AGENT_INBOUND_TOKEN: INBOUND_TOKEN }, /AGENT_URL/],
    [{ AGENT_URL: "http://user:pw@127.0.0.1:8790", AGENT_INBOUND_TOKEN: INBOUND_TOKEN }, /AGENT_URL/],
  ])("refuses %j without printing a token", (extra, message) => {
    let error = "";
    try {
      loadMockConfig({ ...MOCK_ENV, ...extra });
    } catch (e) {
      error = String(e);
    }
    expect(error).toMatch(message);
    for (const secret of [INBOUND_TOKEN, OWNER_TOKEN, "short-inbound", "pw@"]) expect(error).not.toContain(secret);
  });
});
