import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import { createLogRepo } from "../src/repos/log";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Append-only audit log triggers", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-audit-"));
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

  it("2. audit_log: UPDATE and DELETE throw; INSERT works", () => {
    const logRepo = createLogRepo(db);

    // 1. INSERT works via direct SQL
    const insertStmt = db.prepare(`
      INSERT INTO audit_log (
        seq, ts, actor, event, invoice_number, rule_code, explanation, tx_hash, ledger_result, prev_hash, hash
      ) VALUES (1, '2026-11-13T12:00:00.000Z', 'agent', 'invoice_received', 'INV-001', 'OK',
                'Invoice received', NULL, NULL,
                '0000000000000000000000000000000000000000000000000000000000000000',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    `);
    expect(() => insertStmt.run()).not.toThrow();

    // Verify row was inserted
    const row = db.prepare("SELECT * FROM audit_log WHERE seq = 1").get() as any;
    expect(row).toBeDefined();
    expect(row.invoice_number).toBe("INV-001");
    expect(row.explanation).toBe("Invoice received");

    // 2. UPDATE throws due to BEFORE UPDATE trigger
    expect(() => {
      db.prepare("UPDATE audit_log SET explanation = 'tampered' WHERE seq = 1").run();
    }).toThrow(/audit_log is append-only.*UPDATE forbidden/i);

    // Verify row explanation was NOT modified
    const untouchedRow = db.prepare("SELECT explanation FROM audit_log WHERE seq = 1").get() as any;
    expect(untouchedRow.explanation).toBe("Invoice received");

    // 3. DELETE throws due to BEFORE DELETE trigger
    expect(() => {
      db.prepare("DELETE FROM audit_log WHERE seq = 1").run();
    }).toThrow(/audit_log is append-only.*DELETE forbidden/i);

    // Verify row was NOT deleted
    const stillPresent = db.prepare("SELECT seq FROM audit_log WHERE seq = 1").get();
    expect(stillPresent).toBeDefined();

    // 4. logRepo.appendLog also inserts cleanly and advances seq and hash chain
    const entry2 = logRepo.appendLog({
      actor: "policy",
      event: "policy_allowed",
      invoiceNumber: "INV-001",
      ruleCode: "OK",
      explanation: "Policy allowed payment",
    });
    expect(entry2.seq).toBe(2);
    expect(entry2.prev_hash).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(entry2.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
