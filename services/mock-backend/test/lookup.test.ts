import { afterEach, describe, expect, it } from "vitest";
import { DEMO_SEED, mockSupplierAddress } from "../src/index";
import { startTestBackend, type TestBackend } from "./support/backend";

let backend: TestBackend;
afterEach(() => backend?.close());

const lookup = (q: string) => backend.agent("GET", `/suppliers?q=${encodeURIComponent(q)}`);

describe("GET /suppliers?q= confidence", () => {
  it("matches the invoice's legal name to sup_karoo at or above 0.85", async () => {
    backend = await startTestBackend();
    const res = await lookup("Karoo Textiles (Pty) Ltd");
    expect(res.status).toBe(200);
    expect(res.json.supplierId).toBe("sup_karoo");
    expect(res.json.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("scores Zambezi below 0.85 against Karoo, and never returns Karoo for it", async () => {
    backend = await startTestBackend();
    const res = await lookup("Zambezi");
    expect(res.json.supplierId).not.toBe("sup_karoo");
    // Against the default seed, Zambezi only half-matches "Zambezi Spices": not payable either.
    expect(res.json.confidence).toBeLessThan(0.85);
  });

  it("answers notFound for a supplier with no shared word", async () => {
    backend = await startTestBackend();
    expect((await lookup("Atlas Freight")).json).toEqual({ notFound: true });
  });

  it("never offers a removed or pending supplier", async () => {
    backend = await startTestBackend({
      seed: { ...DEMO_SEED, suppliers: DEMO_SEED.suppliers.map((s) => (s.id === "sup_karoo" ? { ...s, status: "removed" as const } : s)) },
    });
    expect((await lookup("Karoo Textiles")).json).toEqual({ notFound: true });
  });

  it("caps the confidence when two suppliers tie, so an ambiguous name is never payable", async () => {
    const [karoo] = DEMO_SEED.suppliers;
    backend = await startTestBackend({
      seed: { ...DEMO_SEED, suppliers: [karoo!, { id: "sup_karoo_two", name: "Karoo Textiles Ltd", address: mockSupplierAddress("sup_karoo_two"), status: "approved" }] },
    });
    const res = await lookup("Karoo Textiles");
    expect(res.json.confidence).toBeLessThan(0.85);
  });

  it("refuses an unknown query parameter or an invisible character with 400", async () => {
    backend = await startTestBackend();
    expect((await backend.agent("GET", "/suppliers?q=Karoo&name=x")).status).toBe(400);
    expect((await lookup("Karoo​Textiles")).status).toBe(400);
  });
});
