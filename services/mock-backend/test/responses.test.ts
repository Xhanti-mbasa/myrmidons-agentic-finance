import { describe, expect, it } from "vitest";
import { createMockApp, DEMO_SEED, loadMockConfig, MockStore } from "../src/index";
import { AGENT_TOKEN, MOCK_ENV } from "./support/backend";

/** A store that has gone wrong: its answers carry an address and a float amount. */
class LeakyStore extends MockStore {
  override rules() {
    return { ...super.rules(), suppliers: [{ id: "sup_karoo", name: "Karoo Textiles", address: DEMO_SEED.suppliers[0]!.address }] } as any;
  }
  override findSupplier() {
    return { supplierId: "sup_karoo", name: "Karoo Textiles", confidence: 1, xrplAddress: DEMO_SEED.suppliers[0]!.address } as any;
  }
}

describe("every response is parsed with its shared schema before it is sent", () => {
  it("turns an off-contract answer into a generic 500 that leaks nothing", async () => {
    const app = createMockApp(loadMockConfig(MOCK_ENV), new LeakyStore(DEMO_SEED, "/nonexistent/approvals.jsonl"));
    for (const path of ["/rules", "/suppliers?q=Karoo"]) {
      const res = await app.request(path, { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "internal error" });
      expect(text).not.toContain(DEMO_SEED.suppliers[0]!.address);
    }
  });
});
