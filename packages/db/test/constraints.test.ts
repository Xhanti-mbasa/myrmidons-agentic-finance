import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Database CHECK constraints", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-constraints-"));
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

  it("4. CHECK constraints refuse negative cents, bad status, bad address", () => {
    // A. Negative cents refused in rules
    expect(() => {
      db.prepare(`
        INSERT INTO rules (id, per_payment_cap_cents, total_budget_cents, period_start, kill_switch, updated_by, updated_at)
        VALUES (1, -5000, 20000, '2026-11-01', 0, 'test', '2026-11-13T12:00:00.000Z')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    expect(() => {
      db.prepare(`
        INSERT INTO rules (id, per_payment_cap_cents, total_budget_cents, period_start, kill_switch, updated_by, updated_at)
        VALUES (1, 5000, -20000, '2026-11-01', 0, 'test', '2026-11-13T12:00:00.000Z')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // Negative cents refused in reservations
    // Seed valid supplier first
    db.prepare(`
      INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
      VALUES ('sup_test', 'Test Supplier', 'r3smzsz3bQWDc729AyEC51EaJjd5PanDM1', NULL, 'approved')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO reservations (invoice_number, supplier_id, amount_cents, status, tx_hash, created_at)
        VALUES ('INV-NEG', 'sup_test', -100, 'reserved', NULL, '2026-11-13T12:00:00.000Z')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // B. Bad status enums refused
    // suppliers status not in ('approved', 'pending', 'removed')
    expect(() => {
      db.prepare(`
        INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
        VALUES ('sup_bad_status', 'Bad Supplier', 'r3smzsz3bQWDc729AyEC51EaJjd5PanDM1', NULL, 'banned')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // approvals status not in ('pending', 'approved', 'rejected')
    expect(() => {
      db.prepare(`
        INSERT INTO approvals (id, kind, payload, status, decided_by, decided_at, invoice_number)
        VALUES ('appr_bad', 'supplier', '{}', 'cancelled', NULL, NULL, 'INV-1')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // reservations status not in ('reserved', 'settled', 'released')
    expect(() => {
      db.prepare(`
        INSERT INTO reservations (invoice_number, supplier_id, amount_cents, status, tx_hash, created_at)
        VALUES ('INV-BAD-STATUS', 'sup_test', 100, 'in_transit', NULL, '2026-11-13T12:00:00.000Z')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // payments status not in ('settled', 'blocked', 'pending_approval', 'failed', 'unknown')
    expect(() => {
      db.prepare(`
        INSERT INTO payments (invoice_number, status, rule_code, tx_hash, log_id, created_at)
        VALUES ('INV-PAY-BAD', 'processing', 'OK', NULL, 'log_1', '2026-11-13T12:00:00.000Z')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // C. Bad addresses refused in suppliers (must be 25-35 chars and start with 'r')
    // Does not start with 'r'
    expect(() => {
      db.prepare(`
        INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
        VALUES ('sup_addr1', 'Bad Addr 1', 'sEdTM123456789012345678901234567', NULL, 'approved')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // Too short (< 25 chars)
    expect(() => {
      db.prepare(`
        INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
        VALUES ('sup_addr2', 'Too Short', 'rShortAddress123', NULL, 'approved')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // Too long (> 35 chars)
    expect(() => {
      db.prepare(`
        INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
        VALUES ('sup_addr3', 'Too Long', 'r12345678901234567890123456789012345678', NULL, 'approved')
      `).run();
    }).toThrow(/CHECK constraint failed/i);

    // Valid inputs succeed
    expect(() => {
      db.prepare(`
        INSERT INTO rules (id, per_payment_cap_cents, total_budget_cents, period_start, kill_switch, updated_by, updated_at)
        VALUES (1, 5000, 20000, '2026-11-01', 0, 'test', '2026-11-13T12:00:00.000Z')
      `).run();
    }).not.toThrow();
  });
});
