import { isValidClassicAddress } from "ripple-address-codec";
import { Wallet } from "xrpl";

export const TESTNET_XRPL_WSS_ALLOWLIST: ReadonlySet<string> = new Set([
  "wss://s.altnet.rippletest.net:51233",
  "wss://testnet.xrpl-labs.com",
]);

export type PolicyServerConfig = {
  policySeed: string;
  callerToken: string;
  agentAccount: string;
  treasuryAccount: string;
  xrplWss: string;
  host: string;
  port: number;
};

export function normalizeWss(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function loadPolicyConfig(env: Record<string, string | undefined>): PolicyServerConfig {
  const policySeed = env.POLICY_SEED?.trim();
  if (!policySeed) {
    throw new Error("POLICY_SEED is required");
  }

  const callerToken = env.POLICY_CALLER_TOKEN?.trim();
  if (!callerToken) {
    throw new Error("POLICY_CALLER_TOKEN is required");
  }

  const agentAccount = env.AGENT_ACCOUNT?.trim();
  if (!agentAccount || !isValidClassicAddress(agentAccount)) {
    throw new Error("AGENT_ACCOUNT must be a valid XRPL classic address");
  }

  const treasuryAccount = env.TREASURY_ACCOUNT?.trim();
  if (!treasuryAccount || !isValidClassicAddress(treasuryAccount)) {
    throw new Error("TREASURY_ACCOUNT must be a valid XRPL classic address");
  }

  const rawXrplWss = env.XRPL_WSS?.trim();
  if (!rawXrplWss) {
    throw new Error("XRPL_WSS is required");
  }

  const xrplWss = normalizeWss(rawXrplWss);
  if (!TESTNET_XRPL_WSS_ALLOWLIST.has(xrplWss)) {
    throw new Error(`XRPL_WSS '${rawXrplWss}' is not on the testnet allowlist`);
  }

  let policyWallet: Wallet;
  try {
    policyWallet = Wallet.fromSeed(policySeed);
  } catch {
    throw new Error("POLICY_SEED is invalid");
  }

  if (policyWallet.classicAddress === agentAccount) {
    throw new Error("POLICY_SEED must not derive the AGENT_ACCOUNT");
  }

  const host = env.POLICY_HOST?.trim() || "127.0.0.1";
  const rawPort = env.POLICY_PORT?.trim();
  const port = rawPort ? parseInt(rawPort, 10) : 8791;
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid POLICY_PORT: ${rawPort}`);
  }

  return {
    policySeed,
    callerToken,
    agentAccount,
    treasuryAccount,
    xrplWss,
    host,
    port,
  };
}
