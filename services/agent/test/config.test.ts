import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "../src/config";

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
