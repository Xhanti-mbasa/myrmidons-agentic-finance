import type { ShucamoxaDb } from "@shucamoxa/db";

const connectionQueues = new WeakMap<ShucamoxaDb, Promise<void>>();

/**
 * Serializes operations on the same DB connection to prevent nested transaction errors.
 */
export async function serializeOnConnection<T>(
  db: ShucamoxaDb,
  fn: () => Promise<T> | T
): Promise<T> {
  const currentQueue = connectionQueues.get(db) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  connectionQueues.set(
    db,
    currentQueue.then(() => next, () => next)
  );

  await currentQueue;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/**
 * Runs a function inside a SQLite BEGIN IMMEDIATE transaction with SQLITE_BUSY retry.
 */
export async function runInImmediateTransaction<T>(
  db: ShucamoxaDb,
  fn: () => Promise<T> | T
): Promise<T> {
  return await serializeOnConnection(db, async () => {
    const maxRetries = 120;
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        db.exec("BEGIN IMMEDIATE;");
        break;
      } catch (err: any) {
        const isBusy =
          err?.code === "SQLITE_BUSY" ||
          err?.code === "SQLITE_LOCKED" ||
          /busy|locked/i.test(err?.message ?? "");
        if (isBusy && attempt < maxRetries) {
          const delay = Math.min(100, Math.floor(Math.random() * 10 * attempt) + 5);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    try {
      const result = await fn();
      db.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw err;
    }
  });
}
