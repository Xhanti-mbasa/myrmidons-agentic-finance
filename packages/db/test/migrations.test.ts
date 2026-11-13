import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Database migrations", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-migrations-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. Migrations apply to empty temp file; running twice is no-op", () => {
    // First run applies all migrations
    const firstRun = migrate(db);
    expect(firstRun.length).toBeGreaterThan(0);
    expect(firstRun[0]?.version).toBe(1);
    expect(firstRun[0]?.name).toBe("initial_schema");

    // Verify all tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("schema_migrations");
    expect(tableNames).toContain("rules");
    expect(tableNames).toContain("suppliers");
    expect(tableNames).toContain("approvals");
    expect(tableNames).toContain("reservations");
    expect(tableNames).toContain("payments");
    expect(tableNames).toContain("audit_log");
    expect(tableNames).toContain("consumed_memo_hashes");

    // Second run must be a complete no-op
    const secondRun = migrate(db);
    expect(secondRun).toEqual([]);
    expect(secondRun.length).toBe(0);

    // Schema migrations table retains exact records
    const records = db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number; name: string }>;
    expect(records).toEqual([{ version: 1, name: "initial_schema" }]);
  });
});
