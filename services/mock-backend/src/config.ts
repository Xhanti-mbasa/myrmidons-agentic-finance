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
  readonly __brand: "MockConfig";
};

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
  return {
    port: typeof port === "number" ? port : port.data,
    agentTokenDigest: digest(agent),
    ownerTokenDigest: digest(owner),
    __brand: "MockConfig",
  };
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

export type Role = "agent" | "owner";

/**
 * Which token an Authorization header carries, or null. Both candidates are always compared, in
 * constant time over equal-length digests, so timing reveals neither the token nor which one matched.
 */
export function roleOf(config: MockConfig, authorization: string | undefined): Role | null {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  const presented = digest(match?.[1] ?? "");
  const isAgent = timingSafeEqual(presented, config.agentTokenDigest);
  const isOwner = timingSafeEqual(presented, config.ownerTokenDigest);
  if (!match) return null;
  return isAgent ? "agent" : isOwner ? "owner" : null;
}
