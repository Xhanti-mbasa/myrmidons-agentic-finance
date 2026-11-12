export type AgentConfig = {
  modelBaseUrl: string;
  modelName: string;
  modelApiKey: string | undefined;
  backendUrl: string;
  backendToken: string;
};

type Env = Record<string, string | undefined>;

/** Variable names that belong to other services (payment, policy, backend), never the agent. */
const FORBIDDEN_NAMES = /SEED|MNEMONIC|PRIVATE_KEY|SECRET_KEY|POLICY_KEY|DATABASE_URL|SERVICE_ROLE/i;

/** XRPL family seeds: base58 (Ripple alphabet) starting with "s"; 29 chars secp256k1, 31 chars ed25519 ("sEd..."). */
const XRPL_SEED = /^s[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{28,30}$/;

export function loadAgentConfig(env: Env): AgentConfig {
  refuseSecrets(env);
  return {
    modelBaseUrl: allowedModelUrl(required(env, "MODEL_BASE_URL"), env.MODEL_FALLBACK_HOST),
    modelName: required(env, "MODEL_NAME"),
    modelApiKey: env.MODEL_API_KEY,
    backendUrl: required(env, "BACKEND_URL"),
    backendToken: required(env, "AGENT_BACKEND_TOKEN"),
  };
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Agent config: ${name} is required`);
  return value;
}

function refuseSecrets(env: Env): void {
  for (const [name, value] of Object.entries(env)) {
    if (FORBIDDEN_NAMES.test(name) || (value !== undefined && XRPL_SEED.test(value.trim()))) {
      // Name the variable so it can be removed; never echo the value.
      throw new Error(`Agent config: the agent's environment must not hold ${name}. Wallet seeds, keys and database credentials belong to other services.`);
    }
  }
}

/**
 * The model server has no authentication (Ollama), so it must be private: localhost or the
 * Tailscale network. The one exception is the hosted fallback, which the squad names explicitly
 * in MODEL_FALLBACK_HOST and which must use HTTPS.
 */
function allowedModelUrl(raw: string, fallbackHost: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Agent config: MODEL_BASE_URL is not a valid URL");
  }
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const isTailscale = isTailscaleIp(host) || host.endsWith(".ts.net");
  const isNamedFallback = fallbackHost !== undefined && host === fallbackHost && url.protocol === "https:";
  if (isLocal || isTailscale || isNamedFallback) return raw;
  throw new Error(
    `Agent config: MODEL_BASE_URL host ${host} is not localhost, Tailscale, or the HTTPS host named in MODEL_FALLBACK_HOST`,
  );
}

/** Tailscale assigns addresses from the CGNAT range 100.64.0.0/10 (100.64.0.0 to 100.127.255.255). */
function isTailscaleIp(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 100 && b >= 64 && b <= 127;
}
