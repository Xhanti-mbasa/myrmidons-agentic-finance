import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBackend, type MockSeed } from "../../src/index";

/** Test-only tokens, 32+ characters, obviously not real. */
export const AGENT_TOKEN = "test-agent-token-not-a-secret-000001";
export const OWNER_TOKEN = "test-owner-token-not-a-secret-000002";
export const INBOUND_TOKEN = "test-inbound-token-not-a-secret-0003";

export const MOCK_ENV = { SHUCAMOXA_MOCK: "1", MOCK_AGENT_TOKEN: AGENT_TOKEN, MOCK_OWNER_TOKEN: OWNER_TOKEN };

export type TestBackend = Awaited<ReturnType<typeof startTestBackend>>;
export type Reply = { status: number; headers: Headers; text: string; json: any };

/** Starts the mock on a free 127.0.0.1 port with its approvals file in a fresh temp directory. */
export async function startTestBackend(options: { seed?: MockSeed; env?: Record<string, string | undefined>; agentTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shucamoxa-mock-"));
  const approvalsFile = join(dir, ".mock", "approvals.jsonl");
  const server = await startMockBackend({ env: options.env ?? MOCK_ENV, port: 0, approvalsFile, seed: options.seed, agentTimeoutMs: options.agentTimeoutMs });

  const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> => {
    const res = await fetch(`${server.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, text, json };
  };

  const call = (token: string | null) => (method: string, path: string, body?: unknown) =>
    send(method, path, token === null ? {} : { Authorization: `Bearer ${token}` }, body);

  /** The dashboard's own origin, as a browser on the page would send it. */
  const origin = server.url;

  /** Raw request with exactly the headers given (plus JSON content type). */
  const raw = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => send(method, path, headers, body);

  /** Logs in as the owner and returns a caller that sends the session cookie and a same-origin Origin. */
  const ownerSession = async (token = OWNER_TOKEN) => {
    const login = await raw("POST", "/owner/login", { Origin: origin }, { token });
    if (login.status !== 200) throw new Error(`owner login failed with ${login.status}`);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const session = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      raw(method, path, { Cookie: cookie, Origin: origin, ...headers }, body);
    return Object.assign(session, { cookie, login });
  };

  return { ...server, approvalsFile, origin, raw, ownerSession, agent: call(AGENT_TOKEN), owner: call(OWNER_TOKEN), anonymous: call(null) };
}

export const pay = (invoiceNumber: string, amount: string, supplierId = "sup_karoo", reason = "Invoice total") => ({
  supplierId,
  amount,
  invoiceNumber,
  reason,
});
