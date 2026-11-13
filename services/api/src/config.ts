import { DEFAULT_DB_PATH } from "@shucamoxa/db";

export interface ApiServerConfig {
  agentToken: string;
  port: number;
  host: string;
  dbPath: string;
  paymentServiceUrl?: string;
  paymentServiceToken?: string;
}

const FORBIDDEN_SEEDS = [
  "XRPL_SEED",
  "TREASURY_SEED",
  "POLICY_SEED",
  "AGENT_SEED",
  "PRIVATE_KEY",
  "WALLET_SEED",
];

export function loadApiConfig(
  env: Record<string, string | undefined> = process.env
): ApiServerConfig {
  for (const forbidden of FORBIDDEN_SEEDS) {
    if (env[forbidden]) {
      throw new Error(
        `ApiServer config guard: ${forbidden} must not be present in API service environment`
      );
    }
  }

  const agentToken = env.AGENT_TOKEN || env.AGENT_BACKEND_TOKEN;
  if (!agentToken || agentToken.trim().length < 16) {
    throw new Error(
      "ApiServer config: AGENT_TOKEN (or AGENT_BACKEND_TOKEN) must be provided and be at least 16 characters"
    );
  }

  const portRaw = env.PORT || env.API_PORT || "8790";
  const port = parseInt(portRaw, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`ApiServer config: invalid PORT "${portRaw}"`);
  }

  const host = env.HOST || env.API_HOST || "127.0.0.1";
  const dbPath = env.SHUCAMOXA_DB_PATH || env.DATABASE_PATH || DEFAULT_DB_PATH;

  return {
    agentToken: agentToken.trim(),
    port,
    host,
    dbPath,
    paymentServiceUrl: env.PAYMENT_SERVICE_URL,
    paymentServiceToken: env.PAYMENT_SERVICE_TOKEN,
  };
}
