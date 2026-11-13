import { describe, expect, it } from "vitest";
import { isValidClassicAddress } from "ripple-address-codec";
import { XrplAddress } from "@shucamoxa/shared";
import { DEMO_SEED, loadMockConfig, mockSupplierAddress, parseSeed, startMockBackend } from "../src/index";
import { AGENT_TOKEN, MOCK_ENV, OWNER_TOKEN, startTestBackend } from "./support/backend";

describe("startup guard", () => {
  it("refuses to start without SHUCAMOXA_MOCK=1", async () => {
    const { SHUCAMOXA_MOCK: _, ...env } = MOCK_ENV;
    await expect(startMockBackend({ env, port: 0 })).rejects.toThrow(/SHUCAMOXA_MOCK=1/);
    expect(() => loadMockConfig(env)).toThrow(/SHUCAMOXA_MOCK=1/);
  });

  it.each(["true", "yes", "0", " 1", ""])("refuses SHUCAMOXA_MOCK=%j", (flag) => {
    expect(() => loadMockConfig({ ...MOCK_ENV, SHUCAMOXA_MOCK: flag })).toThrow(/SHUCAMOXA_MOCK=1/);
  });

  it("refuses to start with NODE_ENV=production even with the flag", () => {
    expect(() => loadMockConfig({ ...MOCK_ENV, NODE_ENV: "production" })).toThrow(/production/);
  });

  it("refuses missing, short or shared tokens without printing them", () => {
    const cases = [
      { ...MOCK_ENV, MOCK_AGENT_TOKEN: undefined },
      { ...MOCK_ENV, MOCK_OWNER_TOKEN: "short-owner-token" },
      { ...MOCK_ENV, MOCK_OWNER_TOKEN: AGENT_TOKEN },
    ];
    for (const env of cases) {
      let message = "";
      try {
        loadMockConfig(env);
      } catch (error) {
        message = String(error);
      }
      expect(message).toMatch(/MOCK_(AGENT|OWNER)_TOKEN/);
      expect(message).not.toContain(AGENT_TOKEN);
      expect(message).not.toContain(OWNER_TOKEN);
      expect(message).not.toContain("short-owner-token");
    }
  });

  it("binds to 127.0.0.1 only", async () => {
    const backend = await startTestBackend();
    try {
      expect(new URL(backend.url).hostname).toBe("127.0.0.1");
    } finally {
      await backend.close();
    }
  });
});

describe("seed", () => {
  it("is the demo: Karoo and Zambezi, a 50.00 cap and a 200.00 budget", () => {
    expect(DEMO_SEED).toMatchObject({ perPaymentCap: "50.00", totalBudget: "200.00", killSwitch: false });
    expect(DEMO_SEED.suppliers.map((s) => [s.id, s.status])).toEqual([
      ["sup_karoo", "approved"],
      ["sup_zambezi", "approved"],
    ]);
  });

  it("holds only checksum-valid, keyless mock addresses derived from the supplier ID", () => {
    for (const s of DEMO_SEED.suppliers) {
      expect(s.address).toBe(mockSupplierAddress(s.id));
      expect(isValidClassicAddress(s.address)).toBe(true);
      expect(XrplAddress.safeParse(s.address).success).toBe(true);
    }
    expect(mockSupplierAddress("sup_karoo")).not.toBe(mockSupplierAddress("sup_zambezi"));
  });

  it("refuses any other address, so a real supplier address can't be loaded into the mock", () => {
    const [karoo, zambezi] = DEMO_SEED.suppliers;
    const swapped = { ...DEMO_SEED, suppliers: [{ ...karoo!, address: zambezi!.address }, zambezi!] };
    expect(() => parseSeed(swapped)).toThrow(/mock address/);
  });
});
