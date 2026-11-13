import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH } from "@shucamoxa/shared";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import { appendLog, cleanExplanation, stripControlCharacters, verifyLog } from "../src/repos/log";
import type { ShucamoxaDb } from "../src/types";

describe("T29 - Hash-chained audit log and verifier", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-log-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath, { busyTimeout: 30000 });
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

  it("1. Concurrency: spawn 3 child processes that each append 50 entries at once -> verifyLog is null and seq is 1..150", async () => {
    const workerScript = resolve(
      fileURLToPath(new URL("./concurrency-worker.ts", import.meta.url))
    );

    const runWorker = (workerId: number): Promise<void> => {
      return new Promise((resolveWorker, rejectWorker) => {
        const child = fork(
          workerScript,
          [dbPath, "50", String(workerId)],
          {
            execArgv: ["--import", "tsx"],
            cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
            stdio: "inherit",
          }
        );

        child.on("exit", (code) => {
          if (code === 0) {
            resolveWorker();
          } else {
            rejectWorker(new Error(`Worker ${workerId} failed with exit code ${code}`));
          }
        });

        child.on("error", rejectWorker);
      });
    };

    // Concurrently run 3 processes
    await Promise.all([runWorker(1), runWorker(2), runWorker(3)]);

    // verifyLog() returns null
    const badSeq = await verifyLog(db);
    expect(badSeq).toBeNull();

    // Exactly 150 rows with seq 1..150
    const rows = db
      .prepare("SELECT seq FROM audit_log ORDER BY seq ASC")
      .all() as Array<{ seq: number }>;
    expect(rows).toHaveLength(150);

    const seqs = rows.map((r) => r.seq);
    const expectedSeqs = Array.from({ length: 150 }, (_, i) => i + 1);
    expect(seqs).toEqual(expectedSeqs);
  }, 45000);

  it("2. Tamper detection: edit row 40's amount -> 40; delete row 10 -> detected; swap two rows -> detected; first row's prev_hash not GENESIS_HASH -> 1", async () => {
    // Populate 50 entries
    for (let i = 1; i <= 50; i++) {
      await appendLog(db, {
        actor: "agent",
        event: "invoice_received",
        invoiceNumber: `INV-${i}`,
        amount: "10.00",
        explanation: `Entry ${i}`,
      });
    }

    // Verify pristine chain
    expect(await verifyLog(db)).toBeNull();

    // 2a. Edit row 40's amount -> returns 40
    db.exec("DROP TRIGGER IF EXISTS audit_log_no_update;");
    db.prepare("UPDATE audit_log SET amount = '99.99' WHERE seq = 40").run();
    expect(await verifyLog(db)).toBe(40);

    // Restore row 40 amount
    db.prepare("UPDATE audit_log SET amount = '10.00' WHERE seq = 40").run();
    expect(await verifyLog(db)).toBeNull();

    // 2b. Delete row 10 -> detected
    db.exec("DROP TRIGGER IF EXISTS audit_log_no_delete;");
    db.prepare("DELETE FROM audit_log WHERE seq = 10").run();
    const badSeqAfterDelete = await verifyLog(db);
    expect(badSeqAfterDelete).not.toBeNull();
    // In verifyChain, the gap is detected at row seq 11 because expectedSeq was 10
    expect(badSeqAfterDelete).toBe(11);

    // 2c. Swap two rows -> detected
    // Start with a fresh database
    const freshDbPath = join(tempDir, "fresh-swap.db");
    const freshDb = createDatabase(freshDbPath);
    migrate(freshDb);
    for (let i = 1; i <= 10; i++) {
      await appendLog(freshDb, {
        actor: "agent",
        event: "invoice_received",
        explanation: `Swap test row ${i}`,
      });
    }
    expect(await verifyLog(freshDb)).toBeNull();

    freshDb.exec("DROP TRIGGER IF EXISTS audit_log_no_update;");
    const row5 = freshDb.prepare("SELECT * FROM audit_log WHERE seq = 5").get() as any;
    const row6 = freshDb.prepare("SELECT * FROM audit_log WHERE seq = 6").get() as any;

    freshDb.prepare(`
      UPDATE audit_log
      SET ts = ?, explanation = ?, prev_hash = ?, hash = ?
      WHERE seq = 5
    `).run(row6.ts, row6.explanation, row6.prev_hash, row6.hash);

    freshDb.prepare(`
      UPDATE audit_log
      SET ts = ?, explanation = ?, prev_hash = ?, hash = ?
      WHERE seq = 6
    `).run(row5.ts, row5.explanation, row5.prev_hash, row5.hash);

    const badSeqSwap = await verifyLog(freshDb);
    expect(badSeqSwap).not.toBeNull();
    freshDb.close();

    // 2d. First row's prev_hash not GENESIS_HASH -> 1
    const freshDbPath2 = join(tempDir, "fresh-first-row.db");
    const freshDb2 = createDatabase(freshDbPath2);
    migrate(freshDb2);
    await appendLog(freshDb2, {
      actor: "owner",
      event: "rules_changed",
      explanation: "Initial row",
    });
    expect(await verifyLog(freshDb2)).toBeNull();

    freshDb2.exec("DROP TRIGGER IF EXISTS audit_log_no_update;");
    freshDb2.prepare("UPDATE audit_log SET prev_hash = ? WHERE seq = 1").run("1".repeat(64));
    expect(await verifyLog(freshDb2)).toBe(1);
    freshDb2.close();
  });

  it("3. Known answer: appending the T03 known-answer entry as the first row yields the T03 expected hash", async () => {
    const KNOWN_ENTRY = {
      seq: 1,
      ts: "2026-11-12T08:00:00.000Z",
      actor: "agent" as const,
      event: "payment_requested" as const,
      invoiceNumber: "INV-1042",
      supplierId: "sup_karoo",
      amount: "30.00",
      ruleCode: null,
      explanation: "Agent requested payment of INV-1042.",
      txHash: null,
      ledgerResult: null,
      prevHash: GENESIS_HASH,
    };
    const KNOWN_ANSWER_HASH =
      "03de26b9343749d04738c706e3b015f59e2c90233ab56ccac30f9e31b7dced43";

    const result = await appendLog(db, KNOWN_ENTRY, {
      clock: () => "2026-11-12T08:00:00.000Z",
    });

    expect(result.seq).toBe(1);
    expect(result.hash).toBe(KNOWN_ANSWER_HASH);

    const badSeq = await verifyLog(db);
    expect(badSeq).toBeNull();
  });

  it("4. Validation: unknown event, float amount, or explanation > 500 chars -> rejected or truncated as specified", async () => {
    // 4a. Unknown event -> rejected
    await expect(
      appendLog(db, {
        actor: "agent",
        event: "unknown_event_type" as any,
        explanation: "Test invalid event",
      })
    ).rejects.toThrow();

    // 4b. Float amount (as number or float string with > 2 decimal places) -> rejected
    await expect(
      appendLog(db, {
        actor: "agent",
        event: "payment_requested",
        amount: 30.5 as any,
        explanation: "Test float number",
      })
    ).rejects.toThrow();

    await expect(
      appendLog(db, {
        actor: "agent",
        event: "payment_requested",
        amount: "30.505",
        explanation: "Test > 2 decimals",
      })
    ).rejects.toThrow();

    // 4c. Explanation > 500 characters -> truncated to 500
    const longText = "z".repeat(600);
    const appendedLong = await appendLog(db, {
      actor: "system",
      event: "rules_changed",
      explanation: longText,
    });
    expect(appendedLong.explanation).toHaveLength(500);
    expect(appendedLong.explanation).toBe("z".repeat(500));

    // 4d. Control characters stripped from explanation
    const dirtyExplanation = "Payment\u0000\u0007\u001F approved\u007F!";
    const appendedClean = await appendLog(db, {
      actor: "policy",
      event: "policy_allowed",
      explanation: dirtyExplanation,
    });
    expect(appendedClean.explanation).toBe("Payment approved!");
  });
});
