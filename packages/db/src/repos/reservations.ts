import type { ReservationRow, ShucamoxaDb } from "../types";

export interface CreateReservationInput {
  invoiceNumber: string;
  supplierId: string;
  amountCents: number;
  status?: "reserved" | "settled" | "released";
  txHash?: string | null;
}

export interface ReservationsRepo {
  createReservation(input: CreateReservationInput): ReservationRow;
  getActiveReservation(invoiceNumber: string): ReservationRow | null;
  getReservationByInvoice(invoiceNumber: string): ReservationRow | null;
  settleReservation(invoiceNumber: string, txHash: string): void;
  releaseReservation(invoiceNumber: string): void;
  getTotalReservedCents(): number;
  getTotalSettledCents(): number;
  listReservations(): ReservationRow[];
}

export function createReservationsRepo(db: ShucamoxaDb): ReservationsRepo {
  return {
    createReservation(input: CreateReservationInput): ReservationRow {
      const createdAt = new Date().toISOString();
      const status = input.status ?? "reserved";
      const txHash = input.txHash ?? null;

      const res = db.prepare(`
        INSERT INTO reservations (invoice_number, supplier_id, amount_cents, status, tx_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.invoiceNumber,
        input.supplierId,
        input.amountCents,
        status,
        txHash,
        createdAt
      );

      return {
        id: Number(res.lastInsertRowid),
        invoice_number: input.invoiceNumber,
        supplier_id: input.supplierId,
        amount_cents: input.amountCents,
        status,
        tx_hash: txHash,
        created_at: createdAt,
      };
    },

    getActiveReservation(invoiceNumber: string): ReservationRow | null {
      const row = db.prepare(`
        SELECT * FROM reservations
        WHERE invoice_number = ? AND status IN ('reserved', 'settled')
        LIMIT 1
      `).get(invoiceNumber) as ReservationRow | undefined;
      return row ?? null;
    },

    getReservationByInvoice(invoiceNumber: string): ReservationRow | null {
      const row = db.prepare(`
        SELECT * FROM reservations
        WHERE invoice_number = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(invoiceNumber) as ReservationRow | undefined;
      return row ?? null;
    },

    settleReservation(invoiceNumber: string, txHash: string): void {
      db.prepare(`
        UPDATE reservations
        SET status = 'settled', tx_hash = ?
        WHERE invoice_number = ? AND status = 'reserved'
      `).run(txHash, invoiceNumber);
    },

    releaseReservation(invoiceNumber: string): void {
      db.prepare(`
        UPDATE reservations
        SET status = 'released'
        WHERE invoice_number = ? AND status = 'reserved'
      `).run(invoiceNumber);
    },

    getTotalReservedCents(): number {
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) AS total
        FROM reservations
        WHERE status = 'reserved'
      `).get() as { total: number };
      return row.total;
    },

    getTotalSettledCents(): number {
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) AS total
        FROM reservations
        WHERE status = 'settled'
      `).get() as { total: number };
      return row.total;
    },

    listReservations(): ReservationRow[] {
      return db.prepare("SELECT * FROM reservations ORDER BY id DESC").all() as ReservationRow[];
    },
  };
}

export const reservationsRepo = createReservationsRepo;
