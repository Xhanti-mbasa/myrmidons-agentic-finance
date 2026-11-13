import { readFileSync } from "node:fs";
import { encodeAccountID } from "ripple-address-codec";
import { z } from "zod";
import { Amount, SupplierId, SupplierName, XrplAddress } from "@shucamoxa/shared";

/**
 * The only address the mock will hold for a supplier: a classic address whose 20-byte account ID is the
 * ASCII text "MOCK:<supplierId>" padded with NULs. Checksum-valid, but nobody can hold its key (that
 * would need a RIPEMD-160/SHA-256 preimage), and it never leaves the mock. Never fund one.
 */
export function mockSupplierAddress(supplierId: string): string {
  const text = new TextEncoder().encode(`MOCK:${supplierId}`);
  if (text.length > 20) throw new Error("mockSupplierAddress: supplier ID too long for a 20-byte mock account ID");
  const accountId = new Uint8Array(20);
  accountId.set(text);
  return encodeAccountID(accountId);
}

const SeedSupplier = z.strictObject({
  id: SupplierId,
  name: SupplierName,
  address: XrplAddress,
  status: z.enum(["approved", "pending", "removed"]),
});

/** fixtures/demo-rules.json. Every address must be the supplier's mock address, so no real one loads. */
export const MockSeed = z
  .strictObject({
    _note: z.string().optional(),
    perPaymentCap: Amount,
    totalBudget: Amount,
    periodStart: z.iso.date(),
    killSwitch: z.boolean(),
    suppliers: z.array(SeedSupplier).min(1),
  })
  .refine((seed) => seed.suppliers.every((s) => s.address === mockSupplierAddress(s.id)), "every supplier address must be its mock address (mockSupplierAddress)")
  .refine((seed) => new Set(seed.suppliers.map((s) => s.id)).size === seed.suppliers.length, "supplier IDs must be unique");
export type MockSeed = z.infer<typeof MockSeed>;

export const DEMO_SEED_PATH = new URL("../../../fixtures/demo-rules.json", import.meta.url);

export function parseSeed(raw: unknown): MockSeed {
  const parsed = MockSeed.safeParse(raw);
  if (!parsed.success) throw new Error(`mock-backend: invalid seed: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

export function loadSeed(path: string | URL = DEMO_SEED_PATH): MockSeed {
  return parseSeed(JSON.parse(readFileSync(path, "utf8")));
}

export const DEMO_SEED: MockSeed = loadSeed();
