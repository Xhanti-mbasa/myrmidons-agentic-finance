import { isValidClassicAddress } from "xrpl";
import { Wallet } from "xrpl";
import { XRPL_TESTNET_WSS } from "@shucamoxa/shared";

/** Allowed Testnet URLs. Signing or setup must refuse any other network. */
export const TESTNET_URL_ALLOWLIST: readonly string[] = Object.freeze([
  XRPL_TESTNET_WSS,
  "wss://testnet.xrpl-labs.com",
]);

const FORBIDDEN_ENV_SEEDS = [
  "POLICY_SEED",
  "OWNER_DEV_SEED",
  "OWNER_SEED",
  "OWNER_KEY",
  "OWNER_SECRET",
];

export interface PaymentConfig {
  host: string;
  port: number;
  paymentCallerToken: string;
  agentSeed: string;
  agentAddress: string;
  treasuryAccount: string;
  policyAccount: string;
  policyUrl: string;
  policyCallerToken?: string;
  xrplWss: string;
  maxFeeDrops: string;
  pollIntervalMs: number;
}

export function assertNoForbiddenSeeds(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  for (const key of FORBIDDEN_ENV_SEEDS) {
    const val = env[key];
    if (val !== undefined && val.trim() !== "") {
      throw new Error(`Startup refused: environment holds forbidden seed variable: ${key}`);
    }
  }
}

export function assertTestnetWss(url: string): void {
  const trimmed = url.trim();
  if (!TESTNET_URL_ALLOWLIST.includes(trimmed)) {
    throw new Error(`Startup refused: non-testnet XRPL_WSS: "${trimmed}". Allowed: ${TESTNET_URL_ALLOWLIST.join(", ")}`);
  }
}

export function loadPaymentConfig(
  rawEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): PaymentConfig {
  assertNoForbiddenSeeds(rawEnv);

  const xrplWss = rawEnv.XRPL_WSS?.trim() || XRPL_TESTNET_WSS;
  assertTestnetWss(xrplWss);

  const paymentCallerToken = rawEnv.PAYMENT_CALLER_TOKEN?.trim();
  if (!paymentCallerToken || paymentCallerToken.length < 32) {
    throw new Error("Startup refused: PAYMENT_CALLER_TOKEN must be at least 32 characters");
  }

  const agentSeed = rawEnv.AGENT_SEED?.trim();
  if (!agentSeed) {
    throw new Error("Startup refused: AGENT_SEED is required");
  }

  let agentAddress: string;
  try {
    const w = Wallet.fromSeed(agentSeed);
    agentAddress = w.address;
  } catch (err: any) {
    throw new Error(`Startup refused: invalid AGENT_SEED: ${err?.message ?? "cannot derive wallet"}`);
  }

  const treasuryAccount = rawEnv.TREASURY_ACCOUNT?.trim();
  if (!treasuryAccount || !isValidClassicAddress(treasuryAccount)) {
    throw new Error(`Startup refused: invalid TREASURY_ACCOUNT: "${treasuryAccount}"`);
  }

  const policyAccount = rawEnv.POLICY_ACCOUNT?.trim();
  if (!policyAccount || !isValidClassicAddress(policyAccount)) {
    throw new Error(`Startup refused: invalid POLICY_ACCOUNT: "${policyAccount}"`);
  }

  const policyUrl = rawEnv.POLICY_URL?.trim() || "http://127.0.0.1:8791";
  const policyCallerToken = rawEnv.POLICY_CALLER_TOKEN?.trim() || rawEnv.POLICY_TOKEN?.trim();

  const host = rawEnv.PAYMENT_HOST?.trim() || "127.0.0.1";
  const port = Number(rawEnv.PAYMENT_PORT?.trim() || 8792);
  const maxFeeDrops = rawEnv.MAX_FEE_DROPS?.trim() || "2000";
  const pollIntervalMs = Number(rawEnv.POLL_INTERVAL_MS?.trim() || 1000);

  return {
    host,
    port,
    paymentCallerToken,
    agentSeed,
    agentAddress,
    treasuryAccount,
    policyAccount,
    policyUrl,
    policyCallerToken,
    xrplWss,
    maxFeeDrops,
    pollIntervalMs,
  };
}
