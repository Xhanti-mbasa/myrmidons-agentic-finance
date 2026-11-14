import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ApprovalRequest, ApprovalResponse, LogEntry, LogFilter, PayRequest, PayResult, Rules, SupplierLookup, SupplierName } from "@shucamoxa/shared";
import { roleOf, type MockConfig, type Role } from "./config";
import { SettlementUnknown, type MockStore } from "./store";

const SupplierQuery = z.strictObject({ q: SupplierName });
const LogPage = z.array(LogEntry).max(50);
const ErrorBody = z.strictObject({ error: z.string() });

type Env = { Variables: { role: Role } };

/**
 * The mock's agent-facing HTTP surface (bearer tokens). The owner dashboard under /owner is a separate
 * app (owner.ts). Every response body is parsed with its schema before it is sent, so the mock can't
 * answer off-contract: a parse failure becomes a generic 500.
 */
export function createMockApp(config: MockConfig, store: MockStore) {
  const app = new Hono<Env>();

  const send = <S extends z.ZodType>(c: Context<Env>, schema: S, body: z.input<S>, status: 200 | 201 | 400 | 401 | 403 | 404 | 413 | 500 | 503 = 200) =>
    c.json(schema.parse(body) as object, status);
  const fail = (c: Context<Env>, status: 400 | 401 | 403 | 404 | 413 | 500 | 503, error: string) => send(c, ErrorBody, { error }, status);

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Shucamoxa-Mock", "1");
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.use("*", bodyLimit({ maxSize: 16 * 1024, onError: (c) => fail(c, 413, "body too large") }));
  app.use("*", async (c, next) => {
    const role = roleOf(config, c.req.header("Authorization"));
    if (!role) return fail(c, 401, "unauthorised");
    c.set("role", role);
    await next();
  });

  const only = (role: Role) => async (c: Context<Env>, next: () => Promise<void>) => {
    if (c.get("role") !== role) return fail(c, 403, "forbidden");
    await next();
  };
  const jsonBody = async (c: Context<Env>): Promise<unknown> => c.req.json().catch(() => undefined);

  app.get("/rules", only("agent"), (c) => send(c, Rules, store.rules()));

  app.get("/suppliers", only("agent"), (c) => {
    const query = SupplierQuery.safeParse(c.req.query());
    if (!query.success) return fail(c, 400, "expected ?q=<supplier name>");
    return send(c, SupplierLookup, store.findSupplier(query.data.q));
  });

  app.post("/payments", only("agent"), async (c) => {
    const request = PayRequest.safeParse(await jsonBody(c));
    if (!request.success) return fail(c, 400, "body is not a PayRequest");
    try {
      return send(c, PayResult, await store.pay(request.data));
    } catch (error) {
      // Unknown settlement outcome: 503 so the agent reports it as unclear and never retries blindly.
      if (error instanceof SettlementUnknown) return fail(c, 503, error.message);
      throw error;
    }
  });

  app.post("/approvals", only("agent"), async (c) => {
    const request = ApprovalRequest.safeParse(await jsonBody(c));
    if (!request.success) return fail(c, 400, "body is not an ApprovalRequest");
    return send(c, ApprovalResponse, await store.requestApproval(request.data), 201);
  });

  app.get("/log", only("agent"), (c) => {
    const filter = LogFilter.safeParse(c.req.query());
    if (!filter.success) return fail(c, 400, "query is not a LogFilter");
    return send(c, LogPage, store.queryLog(filter.data));
  });

  app.notFound((c) => fail(c, 404, "not found"));
  app.onError((_error, c) => fail(c, 500, "internal error"));
  return app;
}
