import type { ApprovalRow, RulesRow, ShucamoxaDb, SupplierRow } from "../types";

export interface SetRulesInput {
  perPaymentCapCents: number;
  totalBudgetCents: number;
  periodStart: string;
  killSwitch?: boolean;
  updatedBy: string;
}

export interface UpsertSupplierInput {
  id: string;
  name: string;
  xrplAddress: string;
  destinationTag?: number | null;
  status: "approved" | "pending" | "removed";
}

export interface CreateApprovalInput {
  id: string;
  kind: "supplier" | "payment";
  payload: unknown;
  status?: "pending" | "approved" | "rejected";
  invoiceNumber: string;
}

export interface RulesWriteRepo {
  setRules(input: SetRulesInput): void;
  setKillSwitch(killSwitch: boolean, updatedBy: string): void;
  upsertSupplier(input: UpsertSupplierInput): void;
  setSupplierStatus(id: string, status: "approved" | "pending" | "removed"): void;
  createApproval(input: CreateApprovalInput): void;
  decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string): void;
  getApproval(id: string): ApprovalRow | null;
}

export function createRulesWriteRepo(db: ShucamoxaDb): RulesWriteRepo {
  return {
    setRules(input: SetRulesInput): void {
      const now = new Date().toISOString();
      const killSwitchInt = input.killSwitch ? 1 : 0;
      db.prepare(`
        INSERT INTO rules (id, per_payment_cap_cents, total_budget_cents, period_start, kill_switch, updated_by, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          per_payment_cap_cents = excluded.per_payment_cap_cents,
          total_budget_cents = excluded.total_budget_cents,
          period_start = excluded.period_start,
          kill_switch = excluded.kill_switch,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(
        input.perPaymentCapCents,
        input.totalBudgetCents,
        input.periodStart,
        killSwitchInt,
        input.updatedBy,
        now
      );
    },

    setKillSwitch(killSwitch: boolean, updatedBy: string): void {
      const now = new Date().toISOString();
      const killSwitchInt = killSwitch ? 1 : 0;
      db.prepare(`
        UPDATE rules
        SET kill_switch = ?, updated_by = ?, updated_at = ?
        WHERE id = 1
      `).run(killSwitchInt, updatedBy, now);
    },

    upsertSupplier(input: UpsertSupplierInput): void {
      db.prepare(`
        INSERT INTO suppliers (id, name, xrpl_address, destination_tag, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          xrpl_address = excluded.xrpl_address,
          destination_tag = excluded.destination_tag,
          status = excluded.status
      `).run(
        input.id,
        input.name,
        input.xrplAddress,
        input.destinationTag ?? null,
        input.status
      );
    },

    setSupplierStatus(id: string, status: "approved" | "pending" | "removed"): void {
      db.prepare("UPDATE suppliers SET status = ? WHERE id = ?").run(status, id);
    },

    createApproval(input: CreateApprovalInput): void {
      const payloadStr =
        typeof input.payload === "string"
          ? input.payload
          : JSON.stringify(input.payload);
      db.prepare(`
        INSERT INTO approvals (id, kind, payload, status, decided_by, decided_at, invoice_number)
        VALUES (?, ?, ?, ?, NULL, NULL, ?)
      `).run(
        input.id,
        input.kind,
        payloadStr,
        input.status ?? "pending",
        input.invoiceNumber
      );
    },

    decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string): void {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE approvals
        SET status = ?, decided_by = ?, decided_at = ?
        WHERE id = ?
      `).run(decision, decidedBy, now, id);
    },

    getApproval(id: string): ApprovalRow | null {
      const row = db
        .prepare("SELECT * FROM approvals WHERE id = ? LIMIT 1")
        .get(id) as ApprovalRow | undefined;
      return row ?? null;
    },
  };
}

export const rulesWriteRepo = createRulesWriteRepo;
