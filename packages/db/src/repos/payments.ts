import type { ConsumedMemoHashRow, PaymentRow, ShucamoxaDb } from "../types";

export interface RecordPaymentInput {
  invoiceNumber: string;
  status: "settled" | "blocked" | "pending_approval" | "failed" | "unknown";
  ruleCode: string;
  txHash?: string | null;
  logId: string;
}

export interface PaymentsRepo {
  recordPayment(input: RecordPaymentInput): PaymentRow;
  getPaymentByInvoice(invoiceNumber: string): PaymentRow | null;
  listPayments(options?: { status?: string; limit?: number }): PaymentRow[];
  consumeMemoHash(hash: string, invoiceNumber: string): void;
  isMemoHashConsumed(hash: string): boolean;
}

export function createPaymentsRepo(db: ShucamoxaDb): PaymentsRepo {
  return {
    recordPayment(input: RecordPaymentInput): PaymentRow {
      const createdAt = new Date().toISOString();
      const txHash = input.txHash ?? null;

      const res = db.prepare(`
        INSERT INTO payments (invoice_number, status, rule_code, tx_hash, log_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.invoiceNumber,
        input.status,
        input.ruleCode,
        txHash,
        input.logId,
        createdAt
      );

      return {
        id: Number(res.lastInsertRowid),
        invoice_number: input.invoiceNumber,
        status: input.status,
        rule_code: input.ruleCode,
        tx_hash: txHash,
        log_id: input.logId,
        created_at: createdAt,
      };
    },

    getPaymentByInvoice(invoiceNumber: string): PaymentRow | null {
      const row = db.prepare(`
        SELECT * FROM payments
        WHERE invoice_number = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(invoiceNumber) as PaymentRow | undefined;
      return row ?? null;
    },

    listPayments(options?: { status?: string; limit?: number }): PaymentRow[] {
      let sql = "SELECT * FROM payments";
      const params: any[] = [];

      if (options?.status) {
        sql += " WHERE status = ?";
        params.push(options.status);
      }
      sql += " ORDER BY id DESC";
      if (options?.limit) {
        sql += " LIMIT ?";
        params.push(options.limit);
      }

      return db.prepare(sql).all(...params) as PaymentRow[];
    },

    consumeMemoHash(hash: string, invoiceNumber: string): void {
      const consumedAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO consumed_memo_hashes (hash, invoice_number, consumed_at)
        VALUES (?, ?, ?)
      `).run(hash, invoiceNumber, consumedAt);
    },

    isMemoHashConsumed(hash: string): boolean {
      const row = db.prepare(`
        SELECT hash FROM consumed_memo_hashes
        WHERE hash = ?
        LIMIT 1
      `).get(hash) as ConsumedMemoHashRow | undefined;
      return Boolean(row);
    },
  };
}

export const paymentsRepo = createPaymentsRepo;
