import { createHash } from "node:crypto";
import {
  Actor,
  canonicalJson,
  GENESIS_HASH,
  LogEvent,
  RuleCode,
} from "@shucamoxa/shared";
import type { AuditLogRow, ShucamoxaDb } from "../types";

export interface AppendLogInput {
  actor: Actor;
  event: LogEvent;
  invoiceNumber?: string | null;
  ruleCode?: RuleCode | null;
  explanation: string;
  txHash?: string | null;
  ledgerResult?: string | null;
}

export interface LogFilterInput {
  invoiceNumber?: string;
  actor?: Actor;
  event?: LogEvent;
  limit?: number;
}

export interface LogRepo {
  appendLog(input: AppendLogInput): AuditLogRow;
  getLastEntry(): AuditLogRow | null;
  getEntries(filter?: LogFilterInput): AuditLogRow[];
  verifyChain(): { valid: boolean; failedSeq: number | null };
}

export function computeLogHash(
  prevHash: string,
  entryWithoutHash: Record<string, unknown>
): string {
  const preimage = prevHash + canonicalJson(entryWithoutHash);
  return createHash("sha256").update(preimage).digest("hex");
}

export function createLogRepo(db: ShucamoxaDb): LogRepo {
  return {
    appendLog(input: AppendLogInput): AuditLogRow {
      const last = db
        .prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1")
        .get() as AuditLogRow | undefined;

      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS_HASH;
      const ts = new Date().toISOString();
      const invoiceNumber = input.invoiceNumber ?? null;
      const ruleCode = input.ruleCode ?? null;
      const txHash = input.txHash ?? null;
      const ledgerResult = input.ledgerResult ?? null;

      const entryWithoutHash = {
        seq,
        ts,
        actor: input.actor,
        event: input.event,
        invoice_number: invoiceNumber,
        rule_code: ruleCode,
        explanation: input.explanation,
        tx_hash: txHash,
        ledger_result: ledgerResult,
        prev_hash: prevHash,
      };

      const hash = computeLogHash(prevHash, entryWithoutHash);

      db.prepare(`
        INSERT INTO audit_log (
          seq, ts, actor, event, invoice_number, rule_code, explanation, tx_hash, ledger_result, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seq,
        ts,
        input.actor,
        input.event,
        invoiceNumber,
        ruleCode,
        input.explanation,
        txHash,
        ledgerResult,
        prevHash,
        hash
      );

      return {
        ...entryWithoutHash,
        hash,
      };
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

        const { hash, ...rest } = row;
        const recomputed = computeLogHash(row.prev_hash, rest);
        if (recomputed !== hash) {
          return { valid: false, failedSeq: row.seq };
        }

        expectedPrev = hash;
        expectedSeq += 1;
      }

      return { valid: true, failedSeq: null };
    },
  };
}

export const logRepo = createLogRepo;
