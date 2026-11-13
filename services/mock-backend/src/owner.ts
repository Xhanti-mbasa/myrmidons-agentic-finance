import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  InvoiceOutcome,
  OwnerApprovalDecisionBody,
  OwnerInvoiceBody,
  OwnerKillSwitchBody,
  OwnerLimitsBody,
  OwnerLoginBody,
  OwnerState,
  ProcessInvoiceResponse,
} from "@shucamoxa/shared";
import { ownerTokenMatches, type MockConfig } from "./config";
import { OwnerRefusal, type MockStore } from "./store";

/** The session cookie. It holds a random session ID, never the owner token. */
export const OWNER_COOKIE = "pg_owner";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
/** POST /owner/api/invoices body cap (the ticket's 20 KB). Every other owner body is far smaller. */
export const MAX_INVOICE_BODY_BYTES = 20 * 1024;
const MAX_BODY_BYTES = 4 * 1024;
/** The agent may take a while (local model), but never forever. */
export const AGENT_TIMEOUT_MS = 90_000;
const MAX_AGENT_RESPONSE_BYTES = 64 * 1024;

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const INVOICES_DIR = new URL("../../../fixtures/invoices/", import.meta.url);
/** The demo invoices the inbox can load: 01-06 only, read once, served read-only. */
const DEMO_INVOICE_IDS = ["01", "02", "03", "04", "05", "06"] as const;

const ErrorBody = z.strictObject({ error: z.string() });
const KillSwitchState = z.strictObject({ killSwitch: z.boolean() });
const DecisionResult = z.strictObject({ approvalId: z.string(), status: z.enum(["approved", "rejected"]) });
const DemoInvoice = z.strictObject({ id: z.string(), name: z.string(), text: z.string() });
const InvoiceResult = z.strictObject({ outcome: InvoiceOutcome });
const LoginResult = z.strictObject({ ok: z.literal(true) });

type Status = 200 | 400 | 401 | 403 | 404 | 409 | 413 | 500 | 502 | 503 | 504;

export type OwnerAppOptions = {
  config: MockConfig;
  store: MockStore;
  /** The dashboard's own origins (known once the server listens). Anything else fails the CSRF check. */
  origins: () => readonly string[];
  agentTimeoutMs?: number;
};

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * The owner dashboard under /owner: the page, its script and stylesheet, login, and /owner/api/*.
 * Authenticated only by the session cookie; a bearer token (agent or owner) is never accepted here.
 */
export function createOwnerApp(options: OwnerAppOptions) {
  const { config, store } = options;
  const agentTimeoutMs = options.agentTimeoutMs ?? AGENT_TIMEOUT_MS;
  const files = {
    html: readFileSync(new URL("index.html", PUBLIC_DIR), "utf8"),
    js: readFileSync(new URL("app.js", PUBLIC_DIR), "utf8"),
    css: readFileSync(new URL("app.css", PUBLIC_DIR), "utf8"),
  };
  const demoInvoices = loadDemoInvoices();

  /** Session ID digest → expiry. Only digests are kept, so a heap dump holds no usable cookie. */
  const sessions = new Map<string, number>();
  const hasSession = (c: Context) => {
    const id = getCookie(c, OWNER_COOKIE);
    if (!id) return false;
    const key = digest(id);
    const expires = sessions.get(key);
    if (expires === undefined) return false;
    if (expires <= Date.now()) {
      sessions.delete(key);
      return false;
    }
    return true;
  };

  const app = new Hono().basePath("/owner");
  const send = <S extends z.ZodType>(c: Context, schema: S, body: z.input<S>, status: Status = 200) => c.json(schema.parse(body) as object, status);
  const fail = (c: Context, status: Status, error: string) => send(c, ErrorBody, { error }, status);
  const jsonBody = async (c: Context): Promise<unknown> => c.req.json().catch(() => undefined);

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Content-Security-Policy", CSP);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("X-Shucamoxa-Mock", "1");
  });

  /** CSRF: a state-changing request must carry one of our own origins. A missing Origin fails closed. */
  const sameOrigin = async (c: Context, next: Next) => {
    const origin = c.req.header("Origin");
    if (origin === undefined || !options.origins().includes(origin)) return fail(c, 403, "cross-origin request refused");
    await next();
  };
  const limit = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => fail(c, 413, `body over ${Math.round(maxSize / 1024)} KB`) });

  // ---- The page ----
  app.get("/", (c) => {
    const view = hasSession(c) ? "dashboard" : "login";
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(files.html.replace('data-view="login"', `data-view="${view}"`));
  });
  app.get("/app.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(files.js);
  });
  app.get("/app.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(files.css);
  });

  // ---- Login ----
  app.post("/login", sameOrigin, limit(MAX_BODY_BYTES), async (c) => {
    const body = OwnerLoginBody.safeParse(await jsonBody(c));
    if (!body.success || !ownerTokenMatches(config, body.data.token)) return fail(c, 401, "wrong owner token");
    const id = randomBytes(32).toString("base64url");
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(digest(id), Date.now() + SESSION_TTL_MS);
    setCookie(c, OWNER_COOKIE, id, { httpOnly: true, sameSite: "Strict", path: "/owner", maxAge: SESSION_TTL_MS / 1000 });
    return send(c, LoginResult, { ok: true });
  });
  app.post("/logout", sameOrigin, (c) => {
    const id = getCookie(c, OWNER_COOKIE);
    if (id) sessions.delete(digest(id));
    deleteCookie(c, OWNER_COOKIE, { path: "/owner", httpOnly: true, sameSite: "Strict" });
    return send(c, LoginResult, { ok: true });
  });

  // ---- /owner/api/*: session first, then the same-origin check on anything that changes state ----
  app.use("/api/*", async (c, next) => {
    if (!hasSession(c)) return fail(c, 401, "owner session required");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    return sameOrigin(c, next);
  });

  app.get("/api/state", (c) => {
    const { suppliers: _suppliers, killSwitch, ...rules } = store.rules();
    return send(c, OwnerState, { rules, killSwitch, suppliers: store.ownerSuppliers(), approvals: store.pendingApprovals(), activity: store.ownerActivity() });
  });

  app.get("/api/demo-invoices/:id", (c) => {
    const invoice = demoInvoices.get(c.req.param("id"));
    if (!invoice) return fail(c, 404, "no such demo invoice");
    return send(c, DemoInvoice, invoice);
  });

  app.post("/api/kill-switch", limit(MAX_BODY_BYTES), async (c) => {
    const body = OwnerKillSwitchBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "expected {on: boolean}");
    return send(c, KillSwitchState, await store.setKillSwitch(body.data.on));
  });

  app.put("/api/limits", limit(MAX_BODY_BYTES), async (c) => {
    const body = OwnerLimitsBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "expected {perPaymentCap, totalBudget} as positive amounts like \"50.00\"");
    try {
      const { suppliers: _suppliers, killSwitch: _killSwitch, ...rules } = await store.setLimits(body.data.perPaymentCap, body.data.totalBudget);
      return send(c, OwnerState.shape.rules, rules);
    } catch (error) {
      if (error instanceof OwnerRefusal) return fail(c, 409, error.message);
      throw error;
    }
  });

  app.post("/api/approvals/:id", limit(MAX_BODY_BYTES), async (c) => {
    const body = OwnerApprovalDecisionBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "expected {decision: \"approve\" | \"reject\"}");
    try {
      return send(c, DecisionResult, await store.decideApproval(c.req.param("id"), body.data.decision));
    } catch (error) {
      if (error instanceof OwnerRefusal) return fail(c, error.reason === "approval_not_found" ? 404 : 409, error.message);
      throw error;
    }
  });

  app.post("/api/invoices", limit(MAX_INVOICE_BODY_BYTES), async (c) => {
    const body = OwnerInvoiceBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "expected {text} with 1-20000 characters of invoice text");
    if (!config.agent) return fail(c, 503, "The agent isn't configured: set AGENT_URL and AGENT_INBOUND_TOKEN.");
    const result = await askAgent(config.agent, body.data.text, agentTimeoutMs);
    if (!result.ok) return fail(c, result.status, result.error);
    return send(c, InvoiceResult, { outcome: result.outcome });
  });

  app.notFound((c) => fail(c, 404, "not found"));
  app.onError((_error, c) => fail(c, 500, "internal error"));
  return app;
}

type AgentAnswer = { ok: true; outcome: InvoiceOutcome } | { ok: false; status: 409 | 502 | 504; error: string };

/** One call to the agent's POST /agent/invoices with a fresh invoiceId. Never retried, never redirected. */
async function askAgent(agent: NonNullable<MockConfig["agent"]>, text: string, timeoutMs: number): Promise<AgentAnswer> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = { ok: false, status: 504, error: `The agent did not answer within ${Math.round(timeoutMs / 1000)} seconds. Check the activity log before sending again.` } as const;
  let res: Response;
  try {
    res = await fetch(`${agent.origin}/agent/invoices`, {
      method: "POST",
      headers: { Authorization: agent.authorization(), "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: `inv_${randomUUID().replaceAll("-", "")}`, text }),
      redirect: "manual",
      signal,
    });
  } catch {
    return signal.aborted ? timedOut : { ok: false, status: 502, error: "The agent is unreachable." };
  }
  let raw: string;
  try {
    raw = await readCapped(res, MAX_AGENT_RESPONSE_BYTES);
  } catch {
    return signal.aborted ? timedOut : { ok: false, status: 502, error: "The agent's answer was unreadable." };
  }
  if (res.status === 409) return { ok: false, status: 409, error: "The agent is already processing this invoice." };
  if (res.status !== 200) return { ok: false, status: 502, error: `The agent refused or failed (HTTP ${res.status}).` };
  let parsed: ReturnType<typeof ProcessInvoiceResponse.safeParse>;
  try {
    parsed = ProcessInvoiceResponse.safeParse(JSON.parse(raw));
  } catch {
    return { ok: false, status: 502, error: "The agent's answer was not JSON." };
  }
  if (!parsed.success) return { ok: false, status: 502, error: "The agent's answer was off-contract." };
  return { ok: true, outcome: parsed.data.outcome };
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("agent response too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function loadDemoInvoices(): Map<string, { id: string; name: string; text: string }> {
  const names = readdirSync(INVOICES_DIR);
  const invoices = new Map<string, { id: string; name: string; text: string }>();
  for (const id of DEMO_INVOICE_IDS) {
    const name = names.find((n) => n.startsWith(`${id}-`) && n.endsWith(".txt"));
    if (name) invoices.set(id, { id, name, text: readFileSync(new URL(name, INVOICES_DIR), "utf8") });
  }
  return invoices;
}

/** True for the paths the owner app serves; everything else goes to the agent app. */
export function isOwnerPath(pathname: string): boolean {
  return pathname === "/owner" || pathname.startsWith("/owner/");
}
