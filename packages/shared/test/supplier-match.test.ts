import { describe, expect, it } from "vitest";
import { supplierNameConfidence, supplierNameTokens } from "../src/index";

/** The agent's payable threshold (MIN_SUPPLIER_CONFIDENCE in services/agent/src/tools.ts). */
const MIN_SUPPLIER_MATCH = 0.85;

describe("supplierNameTokens", () => {
  it("lowercases, strips punctuation and drops company suffixes", () => {
    expect([...supplierNameTokens("Karoo Textiles (Pty) Ltd.")]).toEqual(["karoo", "textiles"]);
    expect([...supplierNameTokens("ACME Co, Inc / Limited")]).toEqual(["acme"]);
  });

  it("splits on punctuation rather than gluing words together", () => {
    expect([...supplierNameTokens("Karoo-Textiles")]).toEqual(["karoo", "textiles"]);
  });

  it("folds compatibility characters, so a fullwidth name gets the same tokens", () => {
    expect([...supplierNameTokens("Ｋaroo Textiles")]).toEqual(["karoo", "textiles"]);
  });

  it("yields nothing for a name made only of suffixes and punctuation", () => {
    expect(supplierNameTokens("(Pty) Ltd.").size).toBe(0);
  });
});

describe("supplierNameConfidence (normalised token overlap)", () => {
  it("scores the invoice's legal name at or above the payable threshold against the approved name", () => {
    expect(supplierNameConfidence("Karoo Textiles (Pty) Ltd", "Karoo Textiles")).toBeGreaterThanOrEqual(MIN_SUPPLIER_MATCH);
  });

  it("scores a different supplier below the threshold", () => {
    expect(supplierNameConfidence("Zambezi", "Karoo Textiles")).toBeLessThan(MIN_SUPPLIER_MATCH);
    expect(supplierNameConfidence("Zambezi", "Karoo Textiles")).toBe(0);
  });

  it("scores a partial name below the threshold: one shared word is not a match", () => {
    expect(supplierNameConfidence("Karoo", "Karoo Textiles")).toBeLessThan(MIN_SUPPLIER_MATCH);
    expect(supplierNameConfidence("Karoo Textiles Wholesale", "Karoo Textiles")).toBeLessThan(MIN_SUPPLIER_MATCH);
  });

  it("is symmetric and stays within 0..1", () => {
    const a = supplierNameConfidence("Zambezi Spices Ltd", "Zambezi");
    expect(a).toBe(supplierNameConfidence("Zambezi", "Zambezi Spices Ltd"));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("scores 0 when either side has no tokens", () => {
    expect(supplierNameConfidence("Pty Ltd", "Pty Ltd")).toBe(0);
    expect(supplierNameConfidence("", "Karoo Textiles")).toBe(0);
  });
});
