import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "../src/config";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_ENV_NAMES, findSecretInValue, loadAgentEnvFile, loadAgentServerConfig, loadAgentStartupConfig } from "../src/config";

const base = {
  MODEL_BASE_URL: "http://100.101.102.103:11434/v1",
  MODEL_NAME: "qwen3:14b",
  BACKEND_URL: "http://localhost:8787",
  AGENT_BACKEND_TOKEN: "agent-scoped-token",
};

describe("loadAgentConfig", () => {
  it("starts with only the model settings and a scoped backend token", () => {
    expect(loadAgentConfig(base)).toMatchObject({
      modelBaseUrl: "http://100.101.102.103:11434/v1",
      modelName: "qwen3:14b",
      backendUrl: "http://localhost:8787",
    });
  });
});

describe("loadAgentConfig refuses secrets the agent must never hold", () => {
  it.each([
    ["an agent wallet seed variable", { AGENT_SEED: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2" }],
    ["a treasury seed variable", { TREASURY_WALLET_SEED: "anything" }],
    ["the policy key", { POLICY_KEY: "anything" }],
    ["a policy private key", { POLICY_PRIVATE_KEY: "anything" }],
    ["a database URL", { DATABASE_URL: "postgres://user:pw@db/shucamoxa" }],
    ["a Supabase service-role key", { SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOi" }],
    ["a mnemonic", { WALLET_MNEMONIC: "abandon abandon abandon" }],
    ["an XRPL seed hidden under an innocent name", { NOTES: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2" }],
    ["a secp256k1 XRPL family seed under an innocent name", { FOO: "snoPBrXtMeMyMHUVTgbuqAfg1SUTb" }],
  ])("refuses to start when the environment holds %s", (_label, extra) => {
    expect(() => loadAgentConfig({ ...base, ...extra })).toThrow(/must not hold/);
  });

  it("names the offending variable but never echoes its value", () => {
    const seed = "sEdTM1uX8pu2do5XvTnutH6HsouMaM2";
    let message = "";
    try {
      loadAgentConfig({ ...base, AGENT_SEED: seed });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("AGENT_SEED");
    expect(message).not.toContain(seed);
  });
});

describe("loadAgentConfig only talks to a private or named model server", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://100.64.0.1:11434/v1",
    "http://100.127.255.254:11434/v1",
    "http://model-laptop.tail1234.ts.net:11434/v1",
  ])("accepts the private model server %s", (url) => {
    expect(loadAgentConfig({ ...base, MODEL_BASE_URL: url }).modelBaseUrl).toBe(url);
  });

  it.each([
    ["a public IP", "http://41.13.22.7:11434/v1"],
    ["an address just outside the Tailscale range", "http://100.128.0.1:11434/v1"],
    ["a tunnel that exposes the laptop to the internet", "https://abc123.ngrok-free.app/v1"],
    ["a hostname that only pretends to be Tailscale", "http://ts.net.evil.example/v1"],
    ["a hosted provider nobody named", "https://api.some-llm.example/v1"],
    ["a URL that is not a URL", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(() => loadAgentConfig({ ...base, MODEL_BASE_URL: url })).toThrow(/MODEL_BASE_URL/);
  });

  it("accepts the hosted fallback when the squad names its host and it uses HTTPS", () => {
    const env = { ...base, MODEL_BASE_URL: "https://api.fallback.example/v1", MODEL_FALLBACK_HOST: "api.fallback.example" };
    expect(loadAgentConfig(env).modelBaseUrl).toBe("https://api.fallback.example/v1");
  });

  it("refuses the named hosted fallback over plain HTTP", () => {
    const env = { ...base, MODEL_BASE_URL: "http://api.fallback.example/v1", MODEL_FALLBACK_HOST: "api.fallback.example" };
    expect(() => loadAgentConfig(env)).toThrow(/MODEL_BASE_URL/);
  });
});

// ---------------------------------------------------------------------------------------------
// T09 (G7): allowlisted .env file, name and value scanning, BACKEND_URL validation.
//
// Fake secrets are built at runtime so gitleaks sees no literal key in this file. The only literal
// seed is the publicly documented fake one already on the .gitleaks.toml allowlist for this path.
// ---------------------------------------------------------------------------------------------

const FAKE_SEED = "sEdTM1uX8pu2do5XvTnutH6HsouMaM2";
const HEX64 = "1f2e3d4c5b6a7980".repeat(4);
const ED_KEY = ["E", "D"].join("") + HEX64.toUpperCase();
const SECP_KEY = ["0", "0"].join("") + HEX64;
const MNEMONIC_12 = `${"abandon ".repeat(11)}about`;
const MNEMONIC_24 = `${"abandon ".repeat(23)}art`;
const mnemonic = (words: number) => `${"abandon ".repeat(words - 1)}zoo`;
const PG_ASYNC_URL = ["postgresql", "+asyncpg", "://app:pw@db.internal:5432/ledger"].join("");
const SB_SECRET = ["sb", "_secret_", "N7qR".repeat(8)].join("");
const PG_URL = ["postgres", "ql", "://app:pw@db.internal:5432/ledger"].join("");
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), "c2lnbmF0dXJlLW5vdC1yZWFs"].join(".");
const SERVICE_ROLE_JWT = jwt({ iss: "supabase", ref: "demo", role: "service_role", iat: 1 });
const ANON_JWT = jwt({ iss: "supabase", ref: "demo", role: "anon", iat: 1 });

/** Every case the agent must refuse, with the variable that holds the offending value. */
const G7_NAMES = [
  "AGENT_KEY",
  "WALLET_SECRET",
  "XRPL_SECRET",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_KEY",
  "POSTGRES_URL",
  "PGPASSWORD",
  "OWNER_KEY",
  "PAYMENT_SERVICE_TOKEN",
];
const INNOCENT_VALUE = "harmless-value-42";

const VALUE_CASES: Array<[string, string, string]> = [
  ["a seed inside JSON", "WALLET_JSON", JSON.stringify({ s: FAKE_SEED })],
  ["a seed with surrounding spaces", "NOTES", `   ${FAKE_SEED}  `],
  ["a seed mid-sentence", "NOTES", `the funds sit in ${FAKE_SEED}, keep it safe`],
  ["an ED-prefixed 64-hex key", "NOTES", ED_KEY],
  ["a 00-prefixed 64-hex key", "NOTES", SECP_KEY],
  ["a plain 64-hex key", "NOTES", HEX64],
  ["a 64-hex key inside JSON", "WALLET_JSON", JSON.stringify({ k: ED_KEY })],
  ["a 12-word mnemonic", "NOTES", MNEMONIC_12],
  ["a 24-word mnemonic", "NOTES", MNEMONIC_24],
  ["a mnemonic inside JSON", "WALLET_JSON", JSON.stringify({ m: MNEMONIC_12 })],
  ["a 15-word mnemonic", "NOTES", mnemonic(15)],
  ["an 18-word mnemonic", "NOTES", mnemonic(18)],
  ["a 21-word mnemonic", "NOTES", mnemonic(21)],
  ["a mnemonic as a JSON array", "WALLET_JSON", JSON.stringify(MNEMONIC_12.split(" "))],
  ["a mnemonic in brackets with commas", "NOTES", `[${MNEMONIC_12.split(" ").join(",")}]`],
  ["a 0x-prefixed 64-hex key", "NOTES", `0x${HEX64}`],
  ["a 0x-prefixed key in a token slot", "AGENT_INBOUND_TOKEN", `0x${HEX64}`],
  ["a seed in a URL path", "WEBHOOK_URL", `https://hooks.example/w/${FAKE_SEED}`],
  ["a seed after a dash", "NOTES", `backup-${FAKE_SEED}`],
  ["a seed after a percent-encoded colon", "CALLBACK_URL", `https://cb.example/?q=seed%3A${FAKE_SEED}`],
  ["a hex key after a percent-encoded equals sign", "CALLBACK_URL", `https://cb.example/?k%3D${ED_KEY}`],
  ["a postgresql+asyncpg URL", "CACHE_URL", PG_ASYNC_URL],
  ["a Supabase secret key", "API_CRED", SB_SECRET],
  ["a postgres URL under an innocent name", "CACHE_URL", PG_URL],
  ["a postgres:// URL with no credentials", "CACHE_URL", "postgres://db.internal/ledger"],
  ["a Supabase service_role JWT", "API_JWT", SERVICE_ROLE_JWT],
  ["a service_role JWT inside a header value", "EXTRA_HEADERS", `Authorization: Bearer ${SERVICE_ROLE_JWT}`],
  ["an ED-prefixed key in the backend token slot", "AGENT_BACKEND_TOKEN", ED_KEY],
  ["a seed in an allowlisted variable", "MODEL_NAME", FAKE_SEED],
];

const BACKEND_URL_REFUSALS: Array<[string, string]> = [
  ["plain HTTP to a public host", "http://evil.example"],
  ["credentials in the URL", "http://user:pw@127.0.0.1:8787"],
  ["a path", "http://127.0.0.1:8787/api/"],
  ["a path without a trailing slash", "http://127.0.0.1:8787/api"],
  ["a trailing slash", "http://127.0.0.1:8787/"],
  ["a query string", "https://api.example?token=abc"],
  ["a fragment", "https://api.example#frag"],
  ["a scheme that is not HTTP", "ftp://127.0.0.1:8787"],
  ["something that is not a URL", "backend-on-port-8787"],
  ["an address just outside the Tailscale range", "http://100.128.0.1:8787"],
];

const MODEL_URL_REFUSALS = [
  "http://u:p@127.0.0.1:11434/v1",
  "http://41.13.22.7:11434/v1",
  "https://abc123.ngrok-free.app/v1",
  "http://ts.net.evil.example/v1",
  "not a url",
];

describe("T09: every name from the G7 probe is refused", () => {
  it.each(G7_NAMES)("refuses %s even when its value looks harmless", (name) => {
    expect(() => loadAgentConfig({ ...base, [name]: INNOCENT_VALUE })).toThrow(/must not hold/);
  });

  it("refuses AGENT_KEY holding a 66-character ED hex key", () => {
    expect(ED_KEY).toHaveLength(66);
    expect(() => loadAgentConfig({ ...base, AGENT_KEY: ED_KEY })).toThrow(/must not hold AGENT_KEY/);
  });

  it.each(["wallet_secret", "Supabase_Url", "pghost", "treasury_signing_key", "my_policy_api_token", "DB_PASSWD", "SMTP_PASS", "pass", "DB_PASS_FILE", "XRPL_KEY", "xrpl_signing_key"])(
    "refuses the name %s regardless of case or prefix",
    (name) => {
      expect(() => loadAgentConfig({ ...base, [name]: INNOCENT_VALUE })).toThrow(/must not hold/);
    },
  );
});

describe("T09: values are scanned for key shapes anywhere inside them", () => {
  it.each(VALUE_CASES)("refuses %s", (_label, name, value) => {
    expect(() => loadAgentConfig({ ...base, [name]: value })).toThrow(new RegExp(`must not hold ${name}\\b`));
  });

  it("finds each key shape, not just whole values", () => {
    expect(findSecretInValue(`x=${FAKE_SEED};`)).toBeDefined();
    expect(findSecretInValue(`key: ${ED_KEY}\n`)).toBeDefined();
    expect(findSecretInValue(`see ${PG_URL} for details`)).toBeDefined();
  });

  it.each([
    ["an ordinary sentence", "build the invoice parser and ship it today"],
    ["eleven words is not a mnemonic", `${"abandon ".repeat(10)}about`],
    ["13 BIP39 words is not a mnemonic length", mnemonic(13)],
    ["14 BIP39 words is not a mnemonic length", mnemonic(14)],
    ["13 BIP39 words followed by other text", `${mnemonic(13)} zzzz`],
    ["12 words with one outside the BIP39 list", `${"abandon ".repeat(11)}zzzz`],
    ["a 12-word mnemonic in capitals", MNEMONIC_12.toUpperCase()],
    ["a git commit SHA", "8f14e45fceea167a5a36dedd4bea2543c0d1a2b3"],
    ["a 65-hex run", `${HEX64}a`],
    ["a seed-length run that does not start at a delimiter", `x${FAKE_SEED}`],
    ["a seed-shaped slice of a base64 blob", `QUJD+${FAKE_SEED}/REVG`],
    ["a seed-shaped slice after a token joiner", `ghp_${FAKE_SEED}`],
    ["a seed-shaped slice before a token joiner", `${FAKE_SEED}-x`],
    ["a JWT without service_role", ANON_JWT],
    ["a malformed JWT", "eyJub3Q.eyJub3QganNvbg.sig"],
    ["a mysql URL", "mysql://localhost/app"],
  ])("does not flag %s", (_label, value) => {
    expect(findSecretInValue(value)).toBeUndefined();
  });
});

describe("T09: allowed names and an ordinary developer shell", () => {
  it.each([
    ["MODEL_API_KEY", "sk-or-v1-" + HEX64],
    ["MODEL_API_KEY", "gsk_" + "Q7".repeat(26)],
    ["AGENT_BACKEND_TOKEN", HEX64],
    ["AGENT_BACKEND_TOKEN", "agent-scoped-token"],
    ["AGENT_INBOUND_TOKEN", HEX64.toUpperCase()],
    ["AGENT_HOST", "127.0.0.1"],
    ["AGENT_PORT", "8790"],
    ["LOG_LEVEL", "info"],
  ])("accepts %s holding a token-shaped value", (name, value) => {
    expect(() => loadAgentConfig({ ...base, [name]: value })).not.toThrow();
  });

  it.each([
    ["CLAUDE_CODE_POST_TURN_MEMORY_CONFIG", "after each turn review what changed and save only durable facts about the user and their work"],
    ["CCR_AUTO_MODE_ALLOW", "allow read only commands such as git status and list files without asking the user first"],
    ["COMMIT_GUIDE", "describe what changed and why in plain words and keep the subject line short and clear"],
    ["MOTD", "welcome back remember to pull before you start and run the tests before you push any change"],
    ["NOTES", "build the invoice parser then ship it today and tell the team when the demo is ready to record"],
  ])("accepts an ordinary sentence in %s", (name, value) => {
    expect(() => loadAgentConfig({ ...base, [name]: value })).not.toThrow();
  });

  it.each([
    ["PYTHONHASHSEED", "0"],
    ["PYTHONHASHSEED", "random"],
    ["PYTHONHASHSEED", "4294967295"],
    ["PGID", "1000"],
  ])("accepts %s=%s from an ordinary dev or container environment", (name, value) => {
    expect(() => loadAgentConfig({ ...base, [name]: value })).not.toThrow();
  });

  it.each([
    ["PYTHONHASHSEED", INNOCENT_VALUE],
    ["PYTHONHASHSEED", "12345678901"],
    ["PGID", "1000; x"],
    ["pythonhashseed", "0"],
    ["MY_PYTHONHASHSEED", "0"],
  ])("still refuses %s=%s, which is not the plain number or random those exceptions allow", (name, value) => {
    expect(() => loadAgentConfig({ ...base, [name]: value })).toThrow(/must not hold/);
  });

  it("accepts the common variables of a dev shell, a pnpm script, VS Code and a GitHub Actions runner", () => {
    const devShell = {
      PATH: "/home/dev/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/dev",
      USER: "dev",
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      LANG: "en_ZA.UTF-8",
      EDITOR: "code --wait",
      TMPDIR: "/tmp",
      XDG_RUNTIME_DIR: "/run/user/1000",
      LS_COLORS: "rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01",
      SSH_AUTH_SOCK: "/tmp/ssh-XXXXabcd/agent.1234",
      SSH_AGENT_PID: "1234",
      GPG_AGENT_INFO: "/run/user/1000/gnupg/S.gpg-agent:0:1",
      GITHUB_TOKEN: "ghp" + "_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF2hJ4",
      GH_TOKEN: "github" + "_pat_" + "11ABCDEFG0123456789abc_" + "Zy9".repeat(19) + "Q2",
      NPM_TOKEN: "npm" + "_" + "Zx8".repeat(12),
      NODE_AUTH_TOKEN: "npm" + "_" + "Qw7".repeat(12),
      NODE_OPTIONS: "--max-old-space-size=4096",
      PNPM_HOME: "/home/dev/.local/share/pnpm",
      PNPM_PACKAGE_NAME: "@shucamoxa/agent",
      npm_config_user_agent: "pnpm/10.28.0 npm/? node/v22.11.0 linux x64",
      npm_command: "run-script",
      npm_package_name: "@shucamoxa/agent",
      npm_lifecycle_event: "test",
      VSCODE_GIT_ASKPASS_MAIN: "/usr/share/code/resources/app/extensions/git/dist/askpass-main.js",
      VSCODE_GIT_IPC_HANDLE: "/run/user/1000/vscode-git-1a2b3c4d5e.sock",
      VSCODE_IPC_HOOK_CLI: "/run/user/1000/vscode-ipc-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.sock",
      GIT_ASKPASS: "/usr/share/code/resources/app/extensions/git/dist/askpass.sh",
      SSH_ASKPASS: "/usr/lib/ssh/ssh-askpass",
      SUDO_ASKPASS: "/usr/lib/ssh/ssh-askpass",
      TERM_PROGRAM: "vscode",
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "8f14e45fceea167a5a36dedd4bea2543c0d1a2b3",
      GITHUB_REF: "refs/pull/12/merge",
      GITHUB_RUN_ID: "11938475610",
      GITHUB_WORKSPACE: "/home/runner/work/myrmidons-agentic-finance/myrmidons-agentic-finance",
      RUNNER_OS: "Linux",
      RUNNER_TEMP: "/home/runner/work/_temp",
      ACTIONS_RUNTIME_TOKEN: ANON_JWT,
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/abc/idtoken",
      ImageOS: "ubuntu24",
      constructor: "x",
      ["__proto__"]: "y",
    };
    expect(() => loadAgentConfig({ ...base, ...devShell })).not.toThrow();
  });
});

describe("T09: BACKEND_URL must be private over HTTP, or HTTPS anywhere, with no path or credentials", () => {
  it.each(["http://127.0.0.1:8787", "http://localhost:8787", "http://100.70.1.2:8787", "http://[::1]:8787", "https://api.example"])(
    "accepts %s",
    (url) => {
      expect(loadAgentConfig({ ...base, BACKEND_URL: url }).backendUrl).toBe(url);
    },
  );

  it("refuses credentials in MODEL_BASE_URL too", () => {
    expect(() => loadAgentConfig({ ...base, MODEL_BASE_URL: "http://u:p@127.0.0.1:11434/v1" })).toThrow(/MODEL_BASE_URL must not carry credentials/);
  });

  it.each(BACKEND_URL_REFUSALS)("refuses %s", (_label, url) => {
    expect(() => loadAgentConfig({ ...base, BACKEND_URL: url })).toThrow(/BACKEND_URL/);
  });
});

/** Runs fn and returns the error message, failing the test if fn does not throw. */
function refusalMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

function sixCharSubstrings(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 6 <= value.length; i++) out.push(value.slice(i, i + 6));
  return out;
}

describe("T09: no refusal ever echoes any part of the offending value", () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    ...G7_NAMES.map((name): [string, Record<string, string>, string] => [`name ${name}`, { [name]: INNOCENT_VALUE }, INNOCENT_VALUE]),
    ["AGENT_KEY with an ED key", { AGENT_KEY: ED_KEY }, ED_KEY],
    ...VALUE_CASES.map(([label, name, value]): [string, Record<string, string>, string] => [label, { [name]: value }, value]),
    ...BACKEND_URL_REFUSALS.map(([label, url]): [string, Record<string, string>, string] => [`BACKEND_URL ${label}`, { BACKEND_URL: url }, url]),
    ...MODEL_URL_REFUSALS.map((url): [string, Record<string, string>, string] => [`MODEL_BASE_URL ${url}`, { MODEL_BASE_URL: url }, url]),
  ];

  it("covers every refusal case above", () => {
    expect(cases.length).toBe(G7_NAMES.length + 1 + VALUE_CASES.length + BACKEND_URL_REFUSALS.length + MODEL_URL_REFUSALS.length);
  });

  it.each(cases)("%s: the message names the variable and contains no 6-character piece of the value", (_label, extra, value) => {
    const message = refusalMessage(() => loadAgentConfig({ ...base, ...extra }));
    expect(message).toContain(Object.keys(extra)[0]);
    const leaked = sixCharSubstrings(value).filter((piece) => message.includes(piece));
    expect(leaked).toEqual([]);
  });
});

describe("T09: loadAgentEnvFile reads only allowlisted names from services/agent/.env", () => {
  const dir = mkdtempSync(join(tmpdir(), "shucamoxa-agent-env-"));
  let n = 0;
  const envFile = (content: string) => {
    const path = join(dir, `agent-${n++}.env`);
    writeFileSync(path, content);
    return path;
  };

  it("allowlists exactly the agent's names, including the T12 server settings", () => {
    expect([...AGENT_ENV_NAMES].sort()).toEqual(
      [
        "MODEL_BASE_URL",
        "MODEL_NAME",
        "MODEL_API_KEY",
        "MODEL_FALLBACK_HOST",
        "BACKEND_URL",
        "AGENT_BACKEND_TOKEN",
        "AGENT_INBOUND_TOKEN",
        "AGENT_PORT",
        "AGENT_HOST",
        "AGENT_PLANNER",
        "LOG_LEVEL",
      ].sort(),
    );
  });

  it("parses allowlisted keys, skipping comments and blank lines and stripping quotes", () => {
    const path = envFile(
      [
        "# agent settings",
        "",
        "MODEL_BASE_URL=http://100.101.102.103:11434/v1",
        'MODEL_NAME="qwen3:14b"',
        "MODEL_API_KEY=",
        "BACKEND_URL='http://127.0.0.1:8787'",
        "  AGENT_BACKEND_TOKEN = agent-scoped-token  ",
      ].join("\r\n"),
    );
    expect(loadAgentEnvFile(path)).toEqual({
      MODEL_BASE_URL: "http://100.101.102.103:11434/v1",
      MODEL_NAME: "qwen3:14b",
      BACKEND_URL: "http://127.0.0.1:8787",
      AGENT_BACKEND_TOKEN: "agent-scoped-token",
    });
  });

  it("refuses an unknown key in the file, naming the key but not its value", () => {
    const path = envFile(`MODEL_NAME=qwen3:14b\nTREASURY_ADDRESS=${INNOCENT_VALUE}\n`);
    const message = refusalMessage(() => loadAgentEnvFile(path));
    expect(message).toMatch(/TREASURY_ADDRESS/);
    expect(message).toMatch(/not an agent setting/);
    expect(message).not.toContain(INNOCENT_VALUE);
  });

  it("refuses a secret-named key in the file", () => {
    const path = envFile(`WALLET_SEED=${FAKE_SEED}\n`);
    const message = refusalMessage(() => loadAgentEnvFile(path));
    expect(message).toMatch(/WALLET_SEED/);
    expect(message).not.toContain(FAKE_SEED.slice(0, 6));
  });

  it("refuses a key shape in an allowlisted value in the file", () => {
    const path = envFile(`MODEL_NAME=${FAKE_SEED}\n`);
    expect(() => loadAgentEnvFile(path)).toThrow(/must not hold MODEL_NAME/);
  });

  it("refuses a malformed line by line number, without echoing it", () => {
    const path = envFile(`MODEL_NAME=qwen3:14b\n${FAKE_SEED}\n`);
    const message = refusalMessage(() => loadAgentEnvFile(path));
    expect(message).toMatch(/line 2/);
    expect(sixCharSubstrings(FAKE_SEED).filter((p) => message.includes(p))).toEqual([]);
  });

  it("does not echo a key that is itself shaped like a key", () => {
    const path = envFile(`${ED_KEY}=1\n`);
    const message = refusalMessage(() => loadAgentEnvFile(path));
    expect(message).toMatch(/line 1/);
    expect(sixCharSubstrings(ED_KEY).filter((p) => message.includes(p))).toEqual([]);
  });

  it("accepts services/agent/.env.example, which names every allowlisted setting", () => {
    const example = fileURLToPath(new URL("../.env.example", import.meta.url));
    const names = readFileSync(example, "utf8").match(/^[A-Z_]+(?==)/gm);
    expect([...(names ?? [])].sort()).toEqual([...AGENT_ENV_NAMES].sort());
    expect(() => loadAgentEnvFile(example)).not.toThrow();
  });

  it("refuses a duplicated key", () => {
    const path = envFile("MODEL_NAME=a\nMODEL_NAME=b\n");
    expect(() => loadAgentEnvFile(path)).toThrow(/MODEL_NAME.*more than once/);
  });

  describe("loadAgentStartupConfig", () => {
    const fileEnv = [
      "MODEL_BASE_URL=http://100.101.102.103:11434/v1",
      "MODEL_NAME=qwen3:14b",
      "BACKEND_URL=http://127.0.0.1:8787",
      "AGENT_BACKEND_TOKEN=agent-scoped-token",
    ].join("\n");

    it("builds the config from the file", () => {
      const config = loadAgentStartupConfig({ envFile: envFile(fileEnv), env: { PATH: "/usr/bin" } });
      expect(config).toMatchObject({ modelName: "qwen3:14b", backendUrl: "http://127.0.0.1:8787", backendToken: "agent-scoped-token" });
    });

    it("lets process.env override allowlisted names only", () => {
      const config = loadAgentStartupConfig({
        envFile: envFile(fileEnv),
        env: { MODEL_NAME: "qwen3:32b", BACKEND_URL: "https://api.example" },
      });
      expect(config).toMatchObject({ modelName: "qwen3:32b", backendUrl: "https://api.example" });
    });

    it("works from process.env alone when the file is missing", () => {
      const config = loadAgentStartupConfig({ envFile: join(dir, "missing.env"), env: { ...base } });
      expect(config.modelName).toBe("qwen3:14b");
    });

    it("still scans every process.env variable, not just the allowlisted ones", () => {
      expect(() => loadAgentStartupConfig({ envFile: envFile(fileEnv), env: { WALLET_SECRET: INNOCENT_VALUE } })).toThrow(
        /must not hold WALLET_SECRET/,
      );
      expect(() => loadAgentStartupConfig({ envFile: envFile(fileEnv), env: { NOTES: JSON.stringify({ s: FAKE_SEED }) } })).toThrow(
        /must not hold NOTES/,
      );
    });

    it("refuses an unknown key in the file even when process.env is clean", () => {
      expect(() => loadAgentStartupConfig({ envFile: envFile(`${fileEnv}\nDATABASE_URL=x\n`), env: {} })).toThrow(/DATABASE_URL/);
    });
  });
});

describe("T12: loadAgentServerConfig adds the HTTP service's own settings", () => {
  const INBOUND = "inbound-token-for-the-backend-0123456789";
  const server = { ...base, AGENT_INBOUND_TOKEN: INBOUND };

  it("binds to 127.0.0.1:8790 by default", () => {
    expect(loadAgentServerConfig(server)).toMatchObject({ inboundToken: INBOUND, host: "127.0.0.1", port: 8790 });
  });

  it("accepts another loopback or Tailscale address and a port", () => {
    expect(loadAgentServerConfig({ ...server, AGENT_HOST: "100.101.102.103", AGENT_PORT: "9001" })).toMatchObject({
      host: "100.101.102.103",
      port: 9001,
    });
  });

  it("requires an inbound token", () => {
    expect(() => loadAgentServerConfig(base)).toThrow(/AGENT_INBOUND_TOKEN is required/);
  });

  it("refuses a short inbound token without echoing it", () => {
    const run = () => loadAgentServerConfig({ ...base, AGENT_INBOUND_TOKEN: "short-token" });
    expect(run).toThrow(/AGENT_INBOUND_TOKEN must be at least 32 characters/);
    expect(run).not.toThrow(/short-token/);
  });

  it("accepts a 32-character inbound token and refuses a 31-character one", () => {
    expect(loadAgentServerConfig({ ...base, AGENT_INBOUND_TOKEN: "t".repeat(32) }).inboundToken).toHaveLength(32);
    expect(() => loadAgentServerConfig({ ...base, AGENT_INBOUND_TOKEN: "t".repeat(31) })).toThrow(/at least 32 characters/);
  });

  it("refuses an inbound token equal to the backend token, so the backend token is never accepted inbound", () => {
    const same = "x".repeat(40);
    expect(() => loadAgentServerConfig({ ...server, AGENT_INBOUND_TOKEN: same, AGENT_BACKEND_TOKEN: same })).toThrow(
      /AGENT_INBOUND_TOKEN must differ from AGENT_BACKEND_TOKEN/,
    );
  });

  it.each(["100.64.0.0", "100.127.255.255", "localhost"])("accepts AGENT_HOST=%s, at the edges of 100.64.0.0/10", (host) => {
    expect(loadAgentServerConfig({ ...server, AGENT_HOST: host }).host).toBe(host);
  });

  it.each(["0.0.0.0", "::", "[::1]", "192.168.1.10", "example.com", "box.ts.net", "100.63.255.255", "100.128.0.0", "100.64.0.256", "100.64.300.1", "100.64.0"])("refuses to bind to %s", (host) => {
    expect(() => loadAgentServerConfig({ ...server, AGENT_HOST: host })).toThrow(/AGENT_HOST must be/);
  });

  it.each(["abc", "0", "65536", "80.5", "-1"])("refuses AGENT_PORT=%s", (port) => {
    expect(() => loadAgentServerConfig({ ...server, AGENT_PORT: port })).toThrow(/AGENT_PORT must be/);
  });

  it("still refuses a seed in the environment", () => {
    expect(() => loadAgentServerConfig({ ...server, AGENT_SEED: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2" })).toThrow(/must not hold/);
  });
});
