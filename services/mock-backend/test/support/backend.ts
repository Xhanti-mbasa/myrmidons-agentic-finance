import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBackend, type MockSeed } from "../../src/index";

/** Test-only tokens, 32+ characters, obviously not real. */
export const AGENT_TOKEN = "test-agent-token-not-a-secret-000001";
export const OWNER_TOKEN = "test-owner-token-not-a-secret-000002";

export const MOCK_ENV = { SHUCAMOXA_MOCK: "1", MOCK_AGENT_TOKEN: AGENT_TOKEN, MOCK_OWNER_TOKEN: OWNER_TOKEN };

export type TestBackend = Awaited<ReturnType<typeof startTestBackend>>;

/** Starts the mock on a free 127.0.0.1 port with its approvals file in a fresh temp directory. */
export async function startTestBackend(options: { seed?: MockSeed; env?: Record<string, string | undefined> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shucamoxa-mock-"));
  const approvalsFile = join(dir, ".mock", "approvals.jsonl");
  const server = await startMockBackend({ env: options.env ?? MOCK_ENV, port: 0, approvalsFile, seed: options.seed });

  const call = (token: string | null) => async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${server.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: text ? (JSON.parse(text) as any) : undefined };
  };

  return { ...server, approvalsFile, agent: call(AGENT_TOKEN), owner: call(OWNER_TOKEN), anonymous: call(null) };
}

export const pay = (invoiceNumber: string, amount: string, supplierId = "sup_karoo", reason = "Invoice total") => ({
  supplierId,
  amount,
  invoiceNumber,
  reason,
});
