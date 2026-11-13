import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import { createReservationsRepo } from "../src/repos/reservations";
import { createRulesWriteRepo } from "../src/repos/rules-write";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Budget reservations & partial unique index", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-reservations-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath);
    migrate(db);

    // Seed approved supplier to satisfy foreign key
    const rulesWrite = createRulesWriteRepo(db);
    rulesWrite.upsertSupplier({
      id: "sup_karoo",
      name: "Karoo Textiles",
      xrplAddress: "r3smzsz3bQWDc729AyEC51EaJjd5PanDM1",
      status: "approved",
    });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("3. reservations: insert reserved INV-1, then another reserved INV-1 -> error; mark first released, insert reserved INV-1 -> ok", () => {
    const reservationsRepo = createReservationsRepo(db);

    // Step 1: Insert reserved INV-1 -> succeeds
    const first = reservationsRepo.createReservation({
      invoiceNumber: "INV-1",
      supplierId: "sup_karoo",
      amountCents: 3000,
      status: "reserved",
    });
    expect(first.invoice_number).toBe("INV-1");
    expect(first.status).toBe("reserved");

    // Step 2: Insert another reserved INV-1 -> throws partial unique index error
    expect(() => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-1",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "reserved",
      });
    }).toThrow(/UNIQUE constraint failed/i);

    // Step 3: Mark first released
    reservationsRepo.releaseReservation("INV-1");
    const activeAfterRelease = reservationsRepo.getActiveReservation("INV-1");
    expect(activeAfterRelease).toBeNull();

    // Step 4: Insert reserved INV-1 -> ok!
    const second = reservationsRepo.createReservation({
      invoiceNumber: "INV-1",
      supplierId: "sup_karoo",
      amountCents: 3000,
      status: "reserved",
    });
    expect(second.invoice_number).toBe("INV-1");
    expect(second.status).toBe("reserved");

    // Step 5: Settle second reservation and verify settled also blocks duplicates
    reservationsRepo.settleReservation("INV-1", "0".repeat(64));
    expect(() => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-1",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "reserved",
      });
    }).toThrow(/UNIQUE constraint failed/i);
  });
});
