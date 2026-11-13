/**
 * `pnpm dev:mock` entry point. DEV ONLY, NEVER DEPLOY. The flag must come from the command line, not
 * from .env, so it is checked before services/mock-backend/.env is read.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadMockConfig } from "./config";
import { startMockBackend } from "./server";

try {
  if (process.env.SHUCAMOXA_MOCK !== "1") loadMockConfig(process.env); // throws with the reason
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { url } = await startMockBackend({ env: process.env });
  console.log(`MOCK backend (dev only, never deploy; nothing reaches any ledger) listening on ${url}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "mock-backend failed to start");
  process.exit(1);
}
