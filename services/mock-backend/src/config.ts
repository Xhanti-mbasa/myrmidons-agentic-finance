import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The mock's configuration. Only loadMockConfig makes one, and it refuses unless SHUCAMOXA_MOCK is
 * exactly "1" and NODE_ENV isn't production. Tokens are kept only as SHA-256 digests.
 */
export type MockConfig = {
  readonly port: number;
  readonly agentTokenDigest: Buffer;
  readonly ownerTokenDigest: Buffer;
  /** Where POST /owner/api/invoices forwards to, or null when AGENT_URL isn't set (the route answers 503). */
  readonly agent: AgentProxyConfig | null;
  /** Set only when the policy service may read the full rules (with supplier addresses). */
  readonly policyTokenDigest: Buffer | null;
  readonly settlement: SettlementConfig;
  readonly __brand: "MockConfig";
};

/** Mock by default. xrpl-testnet settles real test RLUSD through the multisig treasury. */
export type SettlementConfig =
  | { readonly mode: "mock" }
  | {
      readonly mode: "xrpl-testnet";
      readonly paymentSignerSeed: string;
      readonly treasuryAccount: string;
      readonly policyAccount: string;
      readonly xrplWss: string;
      readonly policyUrl: string;
      readonly policyCallerToken: string;
      /** Supplier ID to its funded Testnet address, replacing the keyless mock addresses. */
      readonly supplierAddresses: Readonly<Record<string, string>>;
    };

/** The agent's origin and the Authorization header for it. The header is a getter, so the token never serialises. */
export type AgentProxyConfig = { readonly origin: string; readonly authorization: () => string };

type Env = Record<string, string | undefined>;

export const DEFAULT_PORT = 8787;
const MIN_TOKEN_LENGTH = 32;

const Port = z.coerce.number().int().min(0).max(65535);

/** Throws unless this process is explicitly a dev mock. Messages name variables, never their values. */
export function loadMockConfig(env: Env): MockConfig {
  if (env.SHUCAMOXA_MOCK !== "1") {
    throw new Error("mock-backend refuses to start: it is a dev-only mock and needs SHUCAMOXA_MOCK=1 (use `pnpm dev:mock`). Never deploy it.");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("mock-backend refuses to start with NODE_ENV=production: it is a dev-only mock. Never deploy it.");
  }
  const agent = requireToken(env, "MOCK_AGENT_TOKEN");
  const owner = requireToken(env, "MOCK_OWNER_TOKEN");
  if (agent === owner) throw new Error("mock-backend: MOCK_AGENT_TOKEN and MOCK_OWNER_TOKEN must be different tokens");
  const port = env.MOCK_PORT === undefined || env.MOCK_PORT === "" ? DEFAULT_PORT : Port.safeParse(env.MOCK_PORT);
  if (typeof port !== "number" && !port.success) throw new Error("mock-backend: MOCK_PORT must be a port number");
  const policyToken = env.MOCK_POLICY_TOKEN ? requireToken(env, "MOCK_POLICY_TOKEN") : null;
  if (policyToken !== null && (policyToken === agent || policyToken === owner)) {
    throw new Error("mock-backend: MOCK_POLICY_TOKEN must differ from MOCK_AGENT_TOKEN and MOCK_OWNER_TOKEN");
  }
  const settlement = loadSettlement(env);
  if (settlement.mode === "xrpl-testnet" && policyToken === null) {
    throw new Error("mock-backend: SETTLEMENT_MODE=xrpl-testnet needs MOCK_POLICY_TOKEN so the policy service can read the owner's rules");
  }
  return {
    port: typeof port === "number" ? port : port.data,
    agentTokenDigest: digest(agent),
    ownerTokenDigest: digest(owner),
    agent: loadAgentProxy(env, [agent, owner, ...(policyToken ? [policyToken] : [])]),
    policyTokenDigest: policyToken ? digest(policyToken) : null,
    settlement,
    __brand: "MockConfig",
  };
}

const XrplAddressPattern = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function loadSettlement(env: Env): SettlementConfig {
  const mode = env.SETTLEMENT_MODE ?? "mock";
  if (mode === "" || mode === "mock") return { mode: "mock" };
  if (mode !== "xrpl-testnet") throw new Error("mock-backend: SETTLEMENT_MODE must be mock or xrpl-testnet");
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`mock-backend: SETTLEMENT_MODE=xrpl-testnet needs ${name}`);
    return value;
  };
  const address = (name: string) => {
    const value = need(name);
    if (!XrplAddressPattern.test(value)) throw new Error(`mock-backend: ${name} must be an XRPL classic address`);
    return value;
  };
  const supplierAddresses: Record<string, string> = {};
  for (const pair of need("SUPPLIER_ADDRESSES").split(",")) {
    const [id, addr] = pair.split("=").map((part) => part.trim());
    if (!id || !addr || !XrplAddressPattern.test(addr)) throw new Error("mock-backend: SUPPLIER_ADDRESSES must look like sup_karoo=r...,sup_zambezi=r...");
    supplierAddresses[id] = addr;
  }
  return {
    mode: "xrpl-testnet",
    paymentSignerSeed: need("PAYMENT_SIGNER_SEED"),
    treasuryAccount: address("TREASURY_ACCOUNT"),
    policyAccount: address("POLICY_ACCOUNT"),
    xrplWss: need("XRPL_WSS"),
    policyUrl: need("POLICY_URL"),
    policyCallerToken: requireToken(env, "POLICY_CALLER_TOKEN"),
    supplierAddresses,
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** AGENT_URL and AGENT_INBOUND_TOKEN: both or neither. AGENT_URL is a bare http origin on this machine. */
function loadAgentProxy(env: Env, otherTokens: string[]): AgentProxyConfig | null {
  const rawUrl = env.AGENT_URL ?? "";
  const rawToken = env.AGENT_INBOUND_TOKEN ?? "";
  if (rawUrl === "" && rawToken === "") return null;
  if (rawUrl === "") throw new Error("mock-backend: AGENT_INBOUND_TOKEN is set but AGENT_URL is not; set both or neither");
  const token = requireToken(env, "AGENT_INBOUND_TOKEN");
  if (otherTokens.includes(token)) throw new Error("mock-backend: AGENT_INBOUND_TOKEN must differ from MOCK_AGENT_TOKEN and MOCK_OWNER_TOKEN");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("mock-backend: AGENT_URL must be a URL like http://127.0.0.1:8790");
  }
  const bare = url.username === "" && url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "" && !rawUrl.includes("@");
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || !bare) {
    throw new Error("mock-backend: AGENT_URL must be a bare http origin on this machine, like http://127.0.0.1:8790");
  }
  const authorization = `Bearer ${token}`;
  return { origin: url.origin, authorization: () => authorization };
}

function requireToken(env: Env, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < MIN_TOKEN_LENGTH || /\s/.test(value)) {
    throw new Error(`mock-backend: ${name} must be set to a token of at least ${MIN_TOKEN_LENGTH} characters with no spaces (try \`openssl rand -base64 32\`)`);
  }
  return value;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** POST /owner/login: constant time over equal-length digests, so neither length nor content leaks. */
export function ownerTokenMatches(config: MockConfig, presented: string): boolean {
  return timingSafeEqual(digest(presented), config.ownerTokenDigest);
}

export type Role = "agent" | "owner" | "policy";

/** Compared against when no policy token is set, so timing never shows whether one is configured. */
const NO_POLICY_TOKEN = digest("no-policy-token-configured");

/**
 * Which token an Authorization header carries, or null. Both candidates are always compared, in
 * constant time over equal-length digests, so timing reveals neither the token nor which one matched.
 */
export function roleOf(config: MockConfig, authorization: string | undefined): Role | null {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  const presented = digest(match?.[1] ?? "");
  const isAgent = timingSafeEqual(presented, config.agentTokenDigest);
  const isOwner = timingSafeEqual(presented, config.ownerTokenDigest);
  const isPolicy = timingSafeEqual(presented, config.policyTokenDigest ?? NO_POLICY_TOKEN) && config.policyTokenDigest !== null;
  if (!match) return null;
  return isAgent ? "agent" : isOwner ? "owner" : isPolicy ? "policy" : null;
}
