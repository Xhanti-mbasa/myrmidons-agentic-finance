import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  findSecretInValue,
  UNSAFE_ENV_NAME,
  refuseUnsafeEnv,
  type EnvScanOptions,
  type Env,
} from "@shucamoxa/shared";

export {
  findSecretInValue,
  UNSAFE_ENV_NAME,
  refuseUnsafeEnv,
  type EnvScanOptions,
};

export type AgentConfig = {
  modelBaseUrl: string;
  modelName: string;
  modelApiKey: string | undefined;
  backendUrl: string;
  backendToken: string;
};

/**
 * The only names the agent reads, from services/agent/.env or from process.env. Anything else in the
 * .env file is refused. AGENT_INBOUND_TOKEN, AGENT_HOST and AGENT_PORT are read by the HTTP service (T12).
 */
export const AGENT_ENV_NAMES = [
  "MODEL_BASE_URL",
  "MODEL_NAME",
  "MODEL_API_KEY",
  "MODEL_FALLBACK_HOST",
  "BACKEND_URL",
  "AGENT_BACKEND_TOKEN",
  "AGENT_INBOUND_TOKEN",
  "AGENT_PORT",
  "AGENT_HOST",
  "LOG_LEVEL",
] as const;

/**
 * The agent's own credentials. Their values may be a plain 64-hex string, because that is what
 * `openssl rand -hex 32` and some hosted providers produce. Every other key shape is still refused.
 */
const AGENT_TOKEN_NAMES = ["MODEL_API_KEY", "AGENT_BACKEND_TOKEN", "AGENT_INBOUND_TOKEN"] as const;

const AGENT_SCAN: EnvScanOptions = { allowedNames: AGENT_ENV_NAMES, tokenNames: AGENT_TOKEN_NAMES };


/** Builds the config from an environment, refusing it if any variable holds a secret. */
export function loadAgentConfig(env: Env): AgentConfig {
  refuseUnsafeEnv(env, AGENT_SCAN);
  return {
    modelBaseUrl: allowedModelUrl(required(env, "MODEL_BASE_URL"), env.MODEL_FALLBACK_HOST),
    modelName: required(env, "MODEL_NAME"),
    modelApiKey: env.MODEL_API_KEY,
    backendUrl: allowedBackendUrl(required(env, "BACKEND_URL")),
    backendToken: required(env, "AGENT_BACKEND_TOKEN"),
  };
}

export type AgentServerConfig = AgentConfig & { inboundToken: string; host: string; port: number };

/** Shortest AGENT_INBOUND_TOKEN accepted: `openssl rand -base64 32` gives 44 characters. */
const MIN_INBOUND_TOKEN_CHARS = 32;

/**
 * The HTTP service's config (T12): the agent config plus the token callers must present, and where to
 * listen. The inbound token must differ from the backend token, so the agent's own outbound credential
 * is never accepted inbound. Binds to loopback or Tailscale only. Errors never echo a value.
 */
export function loadAgentServerConfig(env: Env): AgentServerConfig {
  const config = loadAgentConfig(env);
  const inboundToken = required(env, "AGENT_INBOUND_TOKEN");
  if (inboundToken.length < MIN_INBOUND_TOKEN_CHARS) {
    throw new Error(`Agent config: AGENT_INBOUND_TOKEN must be at least ${MIN_INBOUND_TOKEN_CHARS} characters`);
  }
  if (inboundToken === config.backendToken) throw new Error("Agent config: AGENT_INBOUND_TOKEN must differ from AGENT_BACKEND_TOKEN");
  const host = env.AGENT_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && !isTailscaleIp(host)) {
    throw new Error("Agent config: AGENT_HOST must be 127.0.0.1, localhost or a Tailscale IP address");
  }
  const port = Number(env.AGENT_PORT || "8790");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Agent config: AGENT_PORT must be a port number from 1 to 65535");
  return { ...config, inboundToken, host, port };
}

const DEFAULT_ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

/**
 * The agent's startup config: services/agent/.env, overridden by process.env for allowlisted names
 * only. Every process.env variable is still scanned, so a secret exported in the shell is refused.
 * A missing .env file is fine (the settings can all come from process.env).
 */
export function loadAgentStartupConfig(options: StartupEnvOptions = {}): AgentConfig {
  return loadAgentConfig(agentStartupEnv(options));
}

type StartupEnvOptions = { envFile?: string; env?: Env };

/** The merged startup environment behind loadAgentStartupConfig, for loaders that read more names (T12). */
export function agentStartupEnv(options: StartupEnvOptions = {}): Env {
  const env = options.env ?? process.env;
  refuseUnsafeEnv(env, AGENT_SCAN);
  const fromFile = loadAgentEnvFile(options.envFile ?? DEFAULT_ENV_FILE, { missingOk: true });
  const merged: Env = { ...fromFile };
  for (const name of AGENT_ENV_NAMES) {
    if (env[name] !== undefined) merged[name] = env[name];
  }
  return merged;
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A tiny .env parser: KEY=VALUE lines, # comments, blank lines, optional matching quotes. No
 * expansion, escapes or inline comments. Only AGENT_ENV_NAMES may appear; empty values count as
 * unset. Errors name the key (or only the line number, if the line or key looks like a secret).
 */
export function loadAgentEnvFile(path: string, options: { missingOk?: boolean } = {}): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (options.missingOk && (e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Agent config: could not read the agent .env file (${(e as NodeJS.ErrnoException).code ?? "read error"})`);
  }
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = `line ${i + 1} of the agent .env file`;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? "" : trimmed.slice(0, eq).trim();
    if (!ENV_KEY.test(key) || findSecretInValue(key)) {
      throw new Error(`Agent config: ${where} is not a KEY=VALUE setting`);
    }
    if (!(AGENT_ENV_NAMES as readonly string[]).includes(key)) {
      const unsafe = UNSAFE_ENV_NAME.test(key) ? ", and the agent's environment must not hold it" : "";
      throw new Error(`Agent config: ${key} on ${where} is not an agent setting${unsafe}. Allowed: ${AGENT_ENV_NAMES.join(", ")}.`);
    }
    if (seen.has(key)) throw new Error(`Agent config: ${key} appears more than once in the agent .env file`);
    seen.add(key);
    const value = unquote(trimmed.slice(eq + 1).trim());
    if (value !== "") out[key] = value;
  });
  refuseUnsafeEnv(out, AGENT_SCAN);
  return out;
}

function unquote(value: string): string {
  const q = value[0];
  if (value.length >= 2 && (q === '"' || q === "'") && value.endsWith(q)) return value.slice(1, -1);
  return value;
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Agent config: ${name} is required`);
  return value;
}

function parseUrl(name: string, raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`Agent config: ${name} must be a valid URL`);
  }
}

/** localhost or the Tailscale network: the only hosts the agent may reach over plain HTTP. */
export function isPrivateHost(host: string): boolean {
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return isLocal || isTailscaleIp(host) || host.endsWith(".ts.net");
}

/**
 * The model server has no authentication (Ollama), so it must be private: localhost or the
 * Tailscale network. The one exception is the hosted fallback, which the squad names explicitly
 * in MODEL_FALLBACK_HOST and which must use HTTPS. The error never echoes the URL or its host.
 */
function allowedModelUrl(raw: string, fallbackHost: string | undefined): string {
  const url = parseUrl("MODEL_BASE_URL", raw);
  if (url.username !== "" || url.password !== "") throw new Error("Agent config: MODEL_BASE_URL must not carry credentials");
  const host = url.hostname;
  const isNamedFallback = fallbackHost !== undefined && host === fallbackHost && url.protocol === "https:";
  if (isPrivateHost(host) || isNamedFallback) return raw;
  throw new Error(
    "Agent config: MODEL_BASE_URL must point at localhost, a Tailscale address, or the HTTPS host named in MODEL_FALLBACK_HOST",
  );
}

/**
 * The backend carries the agent's bearer token, so plain HTTP is allowed only to a private host.
 * The URL is a bare origin: no credentials, path, query, fragment or trailing slash, because the
 * agent appends its own paths. Errors never echo the URL.
 */
function allowedBackendUrl(raw: string): string {
  const url = parseUrl("BACKEND_URL", raw);
  const refuse = (why: string) => new Error(`Agent config: BACKEND_URL ${why}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw refuse("must use HTTP or HTTPS");
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    throw refuse("must use HTTPS unless it points at localhost or a Tailscale address");
  }
  if (url.username !== "" || url.password !== "") throw refuse("must not carry credentials");
  if (url.pathname !== "/" || /[?#]/.test(raw) || raw.trim().endsWith("/")) {
    throw refuse("must be a bare origin, with no path, query, fragment or trailing slash");
  }
  return url.origin;
}

/**
 * Tailscale assigns addresses from the CGNAT range 100.64.0.0/10 (100.64.0.0 to 100.127.255.255).
 * Any CGNAT address passes: this does not prove the interface is Tailscale's.
 */
function isTailscaleIp(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 100 && b >= 64 && b <= 127;
}
