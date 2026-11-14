import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import { createMockApp } from "./app";
import { loadMockConfig } from "./config";
import { createOwnerApp, isOwnerPath } from "./owner";
import { loadSeed, parseSeed, type MockSeed } from "./seed";
import { mockSettler, type SettlerFactory } from "./settlement";
import { testnetSettler } from "./testnet-settler";
import { MockStore } from "./store";

/** The only interface the mock listens on. Not configurable: the mock is never reachable off-host. */
export const MOCK_HOST = "127.0.0.1";

/** Repo-root .mock/approvals.jsonl (gitignored). */
export const DEFAULT_APPROVALS_FILE = fileURLToPath(new URL("../../../.mock/approvals.jsonl", import.meta.url));

export type StartOptions = {
  env: Record<string, string | undefined>;
  /** Overrides MOCK_PORT; 0 picks a free port (tests). */
  port?: number;
  seed?: MockSeed;
  approvalsFile?: string;
  /** Overrides the 90-second agent timeout of POST /owner/api/invoices (tests). */
  agentTimeoutMs?: number;
  /** Tests only: replaces the settler chosen by SETTLEMENT_MODE. */
  settler?: SettlerFactory;
};

/** In Testnet mode every approved supplier must have a funded Testnet address instead of its mock one. */
export function withTestnetAddresses(seed: MockSeed, addresses: Readonly<Record<string, string>>): MockSeed {
  const suppliers = seed.suppliers.map((s) => {
    if (s.status !== "approved") return s;
    const address = addresses[s.id];
    if (!address) throw new Error(`mock-backend: SUPPLIER_ADDRESSES has no Testnet address for approved supplier ${s.id}`);
    return { ...s, address };
  });
  return { ...seed, suppliers };
}

/** Starts the dev mock on 127.0.0.1. Throws (rejects) unless SHUCAMOXA_MOCK=1; see loadMockConfig. */
export async function startMockBackend(options: StartOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const config = loadMockConfig(options.env);
  const baseSeed = options.seed ? parseSeed(options.seed) : loadSeed();
  const settlement = config.settlement;
  const seed = settlement.mode === "xrpl-testnet" ? withTestnetAddresses(baseSeed, settlement.supplierAddresses) : baseSeed;
  const settler = options.settler ?? (settlement.mode === "xrpl-testnet" ? testnetSettler(settlement) : mockSettler);
  const store = new MockStore(seed, options.approvalsFile ?? DEFAULT_APPROVALS_FILE, settler);
  const agentApp = createMockApp(config, store);
  let origins: readonly string[] = [];
  const ownerApp = createOwnerApp({ config, store, origins: () => origins, agentTimeoutMs: options.agentTimeoutMs });
  // /owner and /owner/* are the owner dashboard (session cookie); everything else is the agent API (bearer).
  const fetch = (request: Request) => (isOwnerPath(new URL(request.url).pathname) ? ownerApp.fetch(request) : agentApp.fetch(request));
  const server = createAdaptorServer({ fetch });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? config.port, MOCK_HOST, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  origins = [`http://${MOCK_HOST}:${port}`, `http://localhost:${port}`];
  return {
    url: `http://${MOCK_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if ("closeAllConnections" in server) server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
