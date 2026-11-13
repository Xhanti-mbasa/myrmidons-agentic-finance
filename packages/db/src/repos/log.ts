import { createHash } from "node:crypto";
import {
  Actor,
  auditHashInput,
  canonicalJson,
  GENESIS_HASH,
  hashLogEntry,
  LogEntry,
  LogEvent,
  RuleCode,
  verifyChain,
} from "@shucamoxa/shared";
import { createDatabase, DEFAULT_DB_PATH } from "../connection";
import type { AuditLogRow, ShucamoxaDb } from "../types";

export interface AppendLogInput {
  actor: Actor;
  event: LogEvent;
  invoiceNumber?: string | null;
  invoice_number?: string | null;
  supplierId?: string | null;
  supplier_id?: string | null;
  amount?: string | null;
  ruleCode?: RuleCode | null;
  rule_code?: RuleCode | null;
  explanation: string;
  txHash?: string | null;
  tx_hash?: string | null;
  ledgerResult?: string | null;
  ledger_result?: string | null;
  ts?: string;
  prevHash?: string;
  seq?: number;
}

export interface LogOptions {
  db?: ShucamoxaDb;
  clock?: () => string | Date;
}

export interface AppendLogResult {
  seq: number;
  hash: string;
  ts: string;
  actor: Actor;
  event: LogEvent;
  invoiceNumber: string | null;
  invoice_number: string | null;
  supplierId: string | null;
  supplier_id: string | null;
  amount: string | null;
  ruleCode: RuleCode | null;
  rule_code: RuleCode | null;
  explanation: string;
  txHash: string | null;
  tx_hash: string | null;
  ledgerResult: string | null;
  ledger_result: string | null;
  prevHash: string;
  prev_hash: string;
}

export interface LogFilterInput {
  invoiceNumber?: string;
  actor?: Actor;
  event?: LogEvent;
  limit?: number;
}

export interface LogRepo {
  appendLog(input: AppendLogInput, options?: LogOptions): Promise<AppendLogResult>;
  appendLogSync(input: AppendLogInput, options?: LogOptions): AppendLogResult;
  getLastEntry(): AuditLogRow | null;
  getEntries(filter?: LogFilterInput): AuditLogRow[];
  verifyLog(): Promise<number | null>;
  verifyChain(): { valid: boolean; failedSeq: number | null };
}

let defaultDbInstance: ShucamoxaDb | null = null;

export function getDefaultDatabase(): ShucamoxaDb {
  if (!defaultDbInstance) {
    const dbPath = process.env.SHUCAMOXA_DB_PATH ?? DEFAULT_DB_PATH;
    defaultDbInstance = createDatabase(dbPath);
  }
  return defaultDbInstance;
}

export function setDefaultDatabase(db: ShucamoxaDb | null): void {
  defaultDbInstance = db;
}

function isDb(val: unknown): val is ShucamoxaDb {
  return Boolean(
    val &&
      typeof val === "object" &&
      typeof (val as any).prepare === "function" &&
      typeof (val as any).exec === "function"
  );
}

/** Strips C0 and C1 control characters (U+0000..U+001F, U+007F..U+009F). */
export function stripControlCharacters(text: string): string {
  if (typeof text !== "string") return text as any;
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

/** Strips control characters and caps explanation at 500 characters. */
export function cleanExplanation(explanation: unknown): string {
  if (typeof explanation !== "string") return explanation as any;
  return stripControlCharacters(explanation).slice(0, 500);
}

/** Formats an optional date or ISO string as ISO 8601 UTC with milliseconds. */
export function formatIsoMillis(dateOrString?: string | Date | null): string {
  if (!dateOrString) return new Date().toISOString();
  if (dateOrString instanceof Date) return dateOrString.toISOString();
  const d = new Date(dateOrString);
  if (!isNaN(d.getTime())) return d.toISOString();
  return dateOrString;
}

export function computeLogHash(
  prevHash: string,
  entryWithoutHash: Record<string, unknown>
): string {
  const preimage = auditHashInput(prevHash, entryWithoutHash as any);
  return createHash("sha256").update(preimage).digest("hex");
}

const connectionQueues = new WeakMap<ShucamoxaDb, Promise<void>>();

async function serializeOnConnection<T>(
  db: ShucamoxaDb,
  fn: () => Promise<T>
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

async function runInImmediateTransaction<T>(
  db: ShucamoxaDb,
  fn: () => Promise<T>
): Promise<T> {
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
        const delay = Math.min(100, Math.floor(Math.random() * 15 * attempt) + 10);
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
    } catch {
      // ignore rollback failure if transaction was already aborted
    }
    throw err;
  }
}

function resolveAppendArgs(
  dbOrEntry: ShucamoxaDb | AppendLogInput,
  entryOrOptions?: AppendLogInput | LogOptions,
  maybeOptions?: LogOptions
): { db: ShucamoxaDb; input: AppendLogInput; options?: LogOptions } {
  if (isDb(dbOrEntry)) {
    return {
      db: dbOrEntry,
      input: entryOrOptions as AppendLogInput,
      options: maybeOptions,
    };
  }
  return {
    db: (entryOrOptions as LogOptions)?.db ?? getDefaultDatabase(),
    input: dbOrEntry as AppendLogInput,
    options: entryOrOptions as LogOptions,
  };
}

/**
 * Appends a hash-chained audit log entry inside BEGIN IMMEDIATE.
 * Reads last seq and hash, computes hashLogEntry from @shucamoxa/shared,
 * validates with LogEntry, inserts into audit_log, and returns {seq, hash}.
 */
export async function appendLog(
  dbOrEntry: ShucamoxaDb | AppendLogInput,
  entryOrOptions?: AppendLogInput | LogOptions,
  maybeOptions?: LogOptions
): Promise<AppendLogResult> {
  const { db, input, options } = resolveAppendArgs(
    dbOrEntry,
    entryOrOptions,
    maybeOptions
  );

  return serializeOnConnection(db, async () => {
    return runInImmediateTransaction(db, async () => {
      const last = db
        .prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")
        .get() as { seq: number; hash: string } | undefined;

      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS_HASH;

      const ts = options?.clock
        ? formatIsoMillis(options.clock())
        : input.ts
          ? formatIsoMillis(input.ts)
          : formatIsoMillis();

      const invoiceNumber = input.invoiceNumber ?? input.invoice_number ?? null;
      const supplierId = input.supplierId ?? input.supplier_id ?? null;
      const amount = input.amount !== undefined ? input.amount : null;
      const ruleCode = input.ruleCode ?? input.rule_code ?? null;
      const explanation = cleanExplanation(input.explanation);
      const txHash = input.txHash ?? input.tx_hash ?? null;
      const ledgerResult = input.ledgerResult ?? input.ledger_result ?? null;

      const rowWithoutHash = {
        seq,
        ts,
        actor: input.actor,
        event: input.event,
        invoiceNumber,
        supplierId,
        amount,
        ruleCode,
        explanation,
        txHash,
        ledgerResult,
        prevHash,
      };

      // Validate unhashed candidate with LogEntry schema
      LogEntry.omit({ hash: true }).parse(rowWithoutHash);

      // Compute hash using hashLogEntry from @shucamoxa/shared
      const hash = await hashLogEntry(prevHash, rowWithoutHash);

      // Validate complete entry
      LogEntry.parse({
        ...rowWithoutHash,
        hash,
      });

      db.prepare(`
        INSERT INTO audit_log (
          seq, ts, actor, event, invoice_number, supplier_id, amount,
          rule_code, explanation, tx_hash, ledger_result, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seq,
        ts,
        input.actor,
        input.event,
        invoiceNumber,
        supplierId,
        amount,
        ruleCode,
        explanation,
        txHash,
        ledgerResult,
        prevHash,
        hash
      );

      return {
        ...rowWithoutHash,
        hash,
        invoice_number: invoiceNumber,
        supplier_id: supplierId,
        rule_code: ruleCode,
        tx_hash: txHash,
        ledger_result: ledgerResult,
        prev_hash: prevHash,
      };
    });
  });
}

/**
 * Synchronous variant of appendLog (suitable for synchronous scripts like seed).
 */
export function appendLogSync(
  dbOrEntry: ShucamoxaDb | AppendLogInput,
  entryOrOptions?: AppendLogInput | LogOptions,
  maybeOptions?: LogOptions
): AppendLogResult {
  const { db, input, options } = resolveAppendArgs(
    dbOrEntry,
    entryOrOptions,
    maybeOptions
  );

  db.exec("BEGIN IMMEDIATE;");
  try {
    const last = db
      .prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")
      .get() as { seq: number; hash: string } | undefined;

    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;

    const ts = options?.clock
      ? formatIsoMillis(options.clock())
      : input.ts
        ? formatIsoMillis(input.ts)
        : formatIsoMillis();

    const invoiceNumber = input.invoiceNumber ?? input.invoice_number ?? null;
    const supplierId = input.supplierId ?? input.supplier_id ?? null;
    const amount = input.amount !== undefined ? input.amount : null;
    const ruleCode = input.ruleCode ?? input.rule_code ?? null;
    const explanation = cleanExplanation(input.explanation);
    const txHash = input.txHash ?? input.tx_hash ?? null;
    const ledgerResult = input.ledgerResult ?? input.ledger_result ?? null;

    const rowWithoutHash = {
      seq,
      ts,
      actor: input.actor,
      event: input.event,
      invoiceNumber,
      supplierId,
      amount,
      ruleCode,
      explanation,
      txHash,
      ledgerResult,
      prevHash,
    };

    LogEntry.omit({ hash: true }).parse(rowWithoutHash);
    const hash = computeLogHash(prevHash, rowWithoutHash);
    LogEntry.parse({ ...rowWithoutHash, hash });

    db.prepare(`
      INSERT INTO audit_log (
        seq, ts, actor, event, invoice_number, supplier_id, amount,
        rule_code, explanation, tx_hash, ledger_result, prev_hash, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      seq,
      ts,
      input.actor,
      input.event,
      invoiceNumber,
      supplierId,
      amount,
      ruleCode,
      explanation,
      txHash,
      ledgerResult,
      prevHash,
      hash
    );

    db.exec("COMMIT;");
    return {
      ...rowWithoutHash,
      hash,
      invoice_number: invoiceNumber,
      supplier_id: supplierId,
      rule_code: ruleCode,
      tx_hash: txHash,
      ledger_result: ledgerResult,
      prev_hash: prevHash,
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw err;
  }
}

/**
 * Verifies the full audit log chain using verifyChain from @shucamoxa/shared.
 * Returns the first bad seq or null if the entire log is intact.
 */
export async function verifyLog(
  dbOrOptions?: ShucamoxaDb | { db?: ShucamoxaDb }
): Promise<number | null> {
  const db = isDb(dbOrOptions)
    ? dbOrOptions
    : dbOrOptions?.db ?? getDefaultDatabase();

  const rows = db
    .prepare("SELECT * FROM audit_log ORDER BY seq ASC")
    .all() as AuditLogRow[];

  const entries: LogEntry[] = rows.map((row) => ({
    seq: row.seq,
    ts: row.ts,
    actor: row.actor as Actor,
    event: row.event as LogEvent,
    invoiceNumber: row.invoice_number ?? null,
    supplierId: row.supplier_id ?? null,
    amount: row.amount ?? null,
    ruleCode: (row.rule_code as RuleCode) ?? null,
    explanation: row.explanation,
    txHash: row.tx_hash ?? null,
    ledgerResult: row.ledger_result ?? null,
    prevHash: row.prev_hash,
    hash: row.hash,
  }));

  return await verifyChain(entries);
}

export function createLogRepo(db: ShucamoxaDb, defaultOptions?: LogOptions): LogRepo {
  return {
    appendLog(input: AppendLogInput, options?: LogOptions) {
      return appendLog(db, input, { ...defaultOptions, ...options });
    },

    appendLogSync(input: AppendLogInput, options?: LogOptions) {
      return appendLogSync(db, input, { ...defaultOptions, ...options });
    },

    getLastEntry(): AuditLogRow | null {
      const row = db
        .prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1")
        .get() as AuditLogRow | undefined;
      return row ?? null;
    },

    getEntries(filter?: LogFilterInput): AuditLogRow[] {
      let sql = "SELECT * FROM audit_log";
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter?.invoiceNumber) {
        conditions.push("invoice_number = ?");
        params.push(filter.invoiceNumber);
      }
      if (filter?.actor) {
        conditions.push("actor = ?");
        params.push(filter.actor);
      }
      if (filter?.event) {
        conditions.push("event = ?");
        params.push(filter.event);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY seq ASC";
      if (filter?.limit) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      }

      return db.prepare(sql).all(...params) as AuditLogRow[];
    },

    async verifyLog(): Promise<number | null> {
      return verifyLog(db);
    },

    verifyChain(): { valid: boolean; failedSeq: number | null } {
      const rows = db
        .prepare("SELECT * FROM audit_log ORDER BY seq ASC")
        .all() as AuditLogRow[];

      let expectedPrev = GENESIS_HASH;
      let expectedSeq = 1;

      for (const row of rows) {
        if (row.seq !== expectedSeq) {
          return { valid: false, failedSeq: row.seq };
        }
        if (row.prev_hash !== expectedPrev) {
          return { valid: false, failedSeq: row.seq };
        }

        const candidate = {
          seq: row.seq,
          ts: row.ts,
          actor: row.actor,
          event: row.event,
          invoiceNumber: row.invoice_number ?? null,
          supplierId: row.supplier_id ?? null,
          amount: row.amount ?? null,
          ruleCode: row.rule_code ?? null,
          explanation: row.explanation,
          txHash: row.tx_hash ?? null,
          ledgerResult: row.ledger_result ?? null,
          prevHash: row.prev_hash,
        };

        const recomputed = computeLogHash(row.prev_hash, candidate);
        if (recomputed !== row.hash) {
          return { valid: false, failedSeq: row.seq };
        }

        expectedPrev = row.hash;
        expectedSeq += 1;
      }

      return { valid: true, failedSeq: null };
    },
  };
}

export const logRepo = createLogRepo;
