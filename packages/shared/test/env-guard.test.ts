import { describe, expect, it } from "vitest";
import { findSecretInValue, refuseUnsafeEnv, UNSAFE_ENV_NAME } from "../src/index";

describe("env-guard in @shucamoxa/shared", () => {
  it("detects XRPL seeds in value", () => {
    expect(findSecretInValue("snKNuHkNGQGssRpmZtq46wDsmqZtc")).toBe("an XRPL seed");
  });

  it("detects hex private keys in value", () => {
    expect(findSecretInValue("0x" + "a".repeat(64))).toBe("a 64-hex private key");
    expect(findSecretInValue("a".repeat(64))).toBe("a 64-hex private key");
  });

  it("detects mnemonics in value", () => {
    const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    expect(findSecretInValue(mnemonic)).toBe("a wallet mnemonic");
  });

  it("detects database connection URLs in value", () => {
    expect(findSecretInValue("postgres://user:pass@localhost:5432/db")).toBe("a database connection URL");
    expect(findSecretInValue("postgresql://user:pass@localhost:5432/db")).toBe("a database connection URL");
  });

  it("refuses unsafe env variable names", () => {
    expect(() => {
      refuseUnsafeEnv({ OWNER_KEY: "foo" }, { allowedNames: ["API_URL"], label: "Web config" });
    }).toThrow(/Web config: the environment must not hold OWNER_KEY/);

    expect(() => {
      refuseUnsafeEnv({ DATABASE_URL: "sqlite://foo" }, { allowedNames: ["API_URL"], label: "Web config" });
    }).toThrow(/Web config: the environment must not hold DATABASE_URL/);
  });

  it("allows safe allowed names with harmless values", () => {
    expect(() => {
      refuseUnsafeEnv({ API_URL: "http://127.0.0.1:8790" }, { allowedNames: ["API_URL"], label: "Web config" });
    }).not.toThrow();
  });
});
