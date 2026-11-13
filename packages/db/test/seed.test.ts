import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import { createRulesReadRepo } from "../src/repos/rules-read";
import {
  DEFAULT_KAROO_ADDRESS,
  DEFAULT_ZAMBEZI_ADDRESS,
  seed,
} from "../src/seed";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Demo database seed", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-seed-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath);
    migrate(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("5. Seed runs with and without secrets/setup-output.json", () => {
    const rulesRead = createRulesReadRepo(db);

    // Part A: Seed runs WITHOUT secrets/setup-output.json (file does not exist)
    const missingSetupPath = join(tempDir, "nonexistent-setup-output.json");
    const resultWithout = seed(db, { setupOutputPath: missingSetupPath });

    expect(resultWithout.perPaymentCapCents).toBe(5000);
    expect(resultWithout.totalBudgetCents).toBe(20000);
    expect(resultWithout.periodStart).toBe("2026-11-01");

    // Karoo & Zambezi loaded with defaults
    const karoo = rulesRead.getSupplierById("sup_karoo");
    expect(karoo).toBeDefined();
    expect(karoo?.name).toBe("Karoo Textiles");
    expect(karoo?.xrpl_address).toBe(DEFAULT_KAROO_ADDRESS);
    expect(karoo?.status).toBe("approved");

    const zambezi = rulesRead.getSupplierById("sup_zambezi");
    expect(zambezi).toBeDefined();
    expect(zambezi?.name).toBe("Zambezi Spices");
    expect(zambezi?.xrpl_address).toBe(DEFAULT_ZAMBEZI_ADDRESS);
    expect(zambezi?.status).toBe("approved");

    // Verify rulesRead.getRules() adheres to @shucamoxa/shared Rules schema
    const rules = rulesRead.getRules();
    expect(rules).not.toBeNull();
    expect(rules?.perPaymentCap).toBe("50.00");
    expect(rules?.totalBudget).toBe("200.00");
    expect(rules?.spent).toBe("0.00");
    expect(rules?.reserved).toBe("0.00");
    expect(rules?.remaining).toBe("200.00");
    expect(rules?.killSwitch).toBe(false);
    expect(rules?.suppliers).toHaveLength(2);

    // Part B: Seed runs WITH secrets/setup-output.json
    const customKaroo = "rCustomKaroo1234567890123456789";
    const customZambezi = "rCustomZambezi12345678901234567";
    const setupOutputPath = join(tempDir, "setup-output.json");

    writeFileSync(
      setupOutputPath,
      JSON.stringify(
        {
          supplierA: { address: customKaroo },
          supplierB: { address: customZambezi },
        },
        null,
        2
      ),
      "utf8"
    );

    const resultWith = seed(db, { setupOutputPath });
    expect(resultWith.suppliers.find((s) => s.id === "sup_karoo")?.xrplAddress).toBe(customKaroo);
    expect(resultWith.suppliers.find((s) => s.id === "sup_zambezi")?.xrplAddress).toBe(customZambezi);

    const updatedKaroo = rulesRead.getSupplierById("sup_karoo");
    expect(updatedKaroo?.xrpl_address).toBe(customKaroo);

    const updatedZambezi = rulesRead.getSupplierById("sup_zambezi");
    expect(updatedZambezi?.xrpl_address).toBe(customZambezi);
  });
});
