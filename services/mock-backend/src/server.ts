import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import { createMockApp } from "./app";
import { loadMockConfig } from "./config";
import { loadSeed, parseSeed, type MockSeed } from "./seed";
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
};

/** Starts the dev mock on 127.0.0.1. Throws (rejects) unless SHUCAMOXA_MOCK=1; see loadMockConfig. */
export async function startMockBackend(options: StartOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const config = loadMockConfig(options.env);
  const seed = options.seed ? parseSeed(options.seed) : loadSeed();
  const store = new MockStore(seed, options.approvalsFile ?? DEFAULT_APPROVALS_FILE);
  const server = createAdaptorServer({ fetch: createMockApp(config, store).fetch });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? config.port, MOCK_HOST, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${MOCK_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if ("closeAllConnections" in server) server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
