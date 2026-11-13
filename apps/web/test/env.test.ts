import { describe, expect, it } from "vitest";
import { loadWebConfig } from "../src/env";

describe("Web env guard", () => {
  it("loads valid API_URL successfully", () => {
    const config = loadWebConfig({ API_URL: "http://127.0.0.1:8790" });
    expect(config.apiUrl).toBe("http://127.0.0.1:8790");
  });

  it("fails if API_URL is missing", () => {
    expect(() => loadWebConfig({})).toThrow(/API_URL is required/);
  });

  it("fails if API_URL is invalid", () => {
    expect(() => loadWebConfig({ API_URL: "not-a-url" })).toThrow(/Invalid API_URL/);
  });

  it("refuses XRPL seed in env", () => {
    expect(() =>
      loadWebConfig({
        API_URL: "http://127.0.0.1:8790",
        SOME_SEED: "snKNuHkNGQGssRpmZtq46wDsmqZtc",
      }),
    ).toThrow(/must not hold/i);
  });

  it("refuses private keys in env", () => {
    expect(() =>
      loadWebConfig({
        API_URL: "http://127.0.0.1:8790",
        XRPL_PRIVATE_KEY: "0x" + "b".repeat(64),
      }),
    ).toThrow(/must not hold/i);
  });

  it("refuses wallet mnemonic in env", () => {
    const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    expect(() =>
      loadWebConfig({
        API_URL: "http://127.0.0.1:8790",
        MNEMONIC: mnemonic,
      }),
    ).toThrow(/must not hold/i);
  });

  it("refuses database credentials or tokens in env", () => {
    expect(() =>
      loadWebConfig({
        API_URL: "http://127.0.0.1:8790",
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      }),
    ).toThrow(/must not hold/i);

    expect(() =>
      loadWebConfig({
        API_URL: "http://127.0.0.1:8790",
        AGENT_BACKEND_TOKEN: "a".repeat(64),
      }),
    ).toThrow(/must not hold/i);
  });
});
