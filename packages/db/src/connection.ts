import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShucamoxaDb } from "./types";

const req = createRequire(import.meta.url);

/** Default DB file is data/shucamoxa.db at repo root (gitignored). */
export const DEFAULT_DB_PATH = resolve(
  fileURLToPath(new URL("../../../data/shucamoxa.db", import.meta.url))
);

export interface DatabaseOptions {
  busyTimeout?: number;
  wal?: boolean;
}

/**
 * Creates or opens a SQLite database using better-sqlite3 in WAL mode with busy_timeout: 5000.
 * Transparently falls back to node:sqlite when better-sqlite3 native bindings are absent.
 */
export function createDatabase(
  dbPath: string = DEFAULT_DB_PATH,
  options: DatabaseOptions = {}
): ShucamoxaDb {
  const busyTimeout = options.busyTimeout ?? 5000;
  const wal = options.wal ?? true;

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  try {
    const BetterSqlite3 = req("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    if (wal) db.pragma("journal_mode = WAL");
    db.pragma(`busy_timeout = ${busyTimeout}`);
    db.pragma("foreign_keys = ON");
    return db as ShucamoxaDb;
  } catch {
    // Fallback to node:sqlite (Node 22+ built-in) wrapped to conform to better-sqlite3 interface
    const { DatabaseSync } = req("node:sqlite");
    const rawDb = new DatabaseSync(dbPath);

    if (wal) rawDb.exec("PRAGMA journal_mode = WAL;");
    rawDb.exec(`PRAGMA busy_timeout = ${busyTimeout};`);
    rawDb.exec("PRAGMA foreign_keys = ON;");

    const adapter: any = {
      memory: dbPath === ":memory:",
      readonly: false,
      name: dbPath,
      open: true,
      inTransaction: false,

      exec(sql: string) {
        rawDb.exec(sql);
        return this;
      },

      pragma(source: string) {
        rawDb.exec(`PRAGMA ${source};`);
        return [];
      },

      prepare(sql: string) {
        const stmt = rawDb.prepare(sql);
        return {
          run(...params: any[]) {
            const res = stmt.run(...params);
            return {
              changes: Number(res.changes),
              lastInsertRowid: Number(res.lastInsertRowid),
            };
          },
          get(...params: any[]) {
            return stmt.get(...params);
          },
          all(...params: any[]) {
            return stmt.all(...params);
          },
          iterate(...params: any[]) {
            return stmt.all(...params)[Symbol.iterator]();
          },
        };
      },

      transaction<F extends (...args: any[]) => any>(fn: F) {
        const tx = (...args: Parameters<F>): ReturnType<F> => {
          rawDb.exec("BEGIN IMMEDIATE;");
          try {
            const result = fn(...args);
            rawDb.exec("COMMIT;");
            return result;
          } catch (err) {
            rawDb.exec("ROLLBACK;");
            throw err;
          }
        };
        tx.default = tx;
        tx.deferred = tx;
        tx.immediate = tx;
        tx.exclusive = tx;
        return tx;
      },

      close() {
        rawDb.close();
        this.open = false;
        return this;
      },

      defaultSafeIntegers() {
        return this;
      },
    };

    return adapter as ShucamoxaDb;
  }
}
