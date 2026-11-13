import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  LAST_LEDGER_WINDOW,
  MEMO_TYPE,
  RATE_LIMIT,
  RESERVATION_TTL_MS,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  toHex,
  XRPL_TESTNET_WSS,
  XrplAddress,
} from "../src/index";

describe("constants", () => {
  it("encodes RLUSD as the 20-byte currency code XRPL uses for codes longer than 3 characters", () => {
    expect(RLUSD_CURRENCY_HEX).toBe("524C555344000000000000000000000000000000");
    expect(RLUSD_CURRENCY_HEX).toBe(toHex("RLUSD").padEnd(40, "0"));
  });

  it("names a testnet RLUSD issuer with a valid checksum", () => {
    expect(RLUSD_TESTNET_ISSUER).toBe("rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV");
    expect(XrplAddress.safeParse(RLUSD_TESTNET_ISSUER).success).toBe(true);
  });

  it("points at the public testnet, over TLS", () => {
    expect(XRPL_TESTNET_WSS).toBe("wss://s.altnet.rippletest.net:51233");
  });

  it("has the agreed limits", () => {
    expect(MEMO_TYPE).toBe("payguard/log");
    expect(LAST_LEDGER_WINDOW).toBe(20);
    expect(RATE_LIMIT).toEqual({ count: 5, windowMs: 60000 });
    expect(RESERVATION_TTL_MS).toBe(120000);
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  it("cannot be loosened at runtime by a service mutating the shared rate limit", () => {
    expect(Object.isFrozen(RATE_LIMIT)).toBe(true);
    expect(() => {
      (RATE_LIMIT as { count: number }).count = 1000;
    }).toThrow();
  });
});
