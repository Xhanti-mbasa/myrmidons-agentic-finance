import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Migration, MigrationRecord, ShucamoxaDb } from "./types";

export const DEFAULT_MIGRATIONS_DIR = resolve(
  fileURLToPath(new URL("../migrations", import.meta.url))
);

/**
 * Loads and sorts migration files from the migrations directory.
 * Files must match pattern NNN_name.sql (e.g. 001_initial_schema.sql).
 */
export function loadMigrations(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): Migration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
    const version = parseInt(match[1], 10);
    const name = match[2];
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    return { version, name, sql };
  });
}

/**
 * Applies all pending migrations in order within transactions.
 * Returns the list of newly applied migrations. If none pending, returns [].
 */
export function migrate(
  db: ShucamoxaDb,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): MigrationRecord[] {
  // Ensure schema_migrations exists before checking applied versions
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC")
    .all() as MigrationRecord[];

  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const allMigrations = loadMigrations(migrationsDir);
  const newlyApplied: MigrationRecord[] = [];

  for (const m of allMigrations) {
    if (appliedVersions.has(m.version)) {
      continue;
    }

    const appliedAt = new Date().toISOString();
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      ).run(m.version, m.name, appliedAt);
    })();

    newlyApplied.push({
      version: m.version,
      name: m.name,
      applied_at: appliedAt,
    });
  }

  return newlyApplied;
}
