import {
  fromCents,
  Rules,
  SupplierId,
  SupplierLookup,
  SupplierName,
} from "@shucamoxa/shared";
import type { RulesRow, ShucamoxaDb, SupplierRow } from "../types";

export interface RulesReadRepo {
  getRules(): Rules | null;
  getRawRules(): RulesRow | null;
  getApprovedSuppliers(): Array<{ id: SupplierId; name: SupplierName }>;
  getSupplierById(id: string): SupplierRow | null;
  lookupSupplier(query: string): SupplierLookup;
  listSuppliers(status?: "approved" | "pending" | "removed"): SupplierRow[];
}

export function createRulesReadRepo(db: ShucamoxaDb): RulesReadRepo {
  return {
    getRules(): Rules | null {
      const raw = db
        .prepare("SELECT * FROM rules WHERE id = 1 LIMIT 1")
        .get() as RulesRow | undefined;

      if (!raw) return null;

      const spentRow = db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM reservations WHERE status = 'settled'")
        .get() as { total: number };

      const reservedRow = db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM reservations WHERE status = 'reserved'")
        .get() as { total: number };

      const spentCents = BigInt(spentRow.total);
      const reservedCents = BigInt(reservedRow.total);
      const totalBudgetCents = BigInt(raw.total_budget_cents);

      let remainingCents = totalBudgetCents - spentCents - reservedCents;
      if (remainingCents < 0n) remainingCents = 0n;

      const suppliers = db
        .prepare("SELECT id, name FROM suppliers WHERE status = 'approved' ORDER BY name ASC")
        .all() as Array<{ id: string; name: string }>;

      const candidate = {
        perPaymentCap: fromCents(BigInt(raw.per_payment_cap_cents)),
        totalBudget: fromCents(totalBudgetCents),
        spent: fromCents(spentCents),
        reserved: fromCents(reservedCents),
        remaining: fromCents(remainingCents),
        periodStart: raw.period_start,
        killSwitch: Boolean(raw.kill_switch),
        suppliers: suppliers.map((s) => ({
          id: s.id as SupplierId,
          name: s.name as SupplierName,
        })),
      };

      return Rules.parse(candidate);
    },

    getRawRules(): RulesRow | null {
      const row = db
        .prepare("SELECT * FROM rules WHERE id = 1 LIMIT 1")
        .get() as RulesRow | undefined;
      return row ?? null;
    },

    getApprovedSuppliers(): Array<{ id: SupplierId; name: SupplierName }> {
      const rows = db
        .prepare("SELECT id, name FROM suppliers WHERE status = 'approved' ORDER BY name ASC")
        .all() as Array<{ id: string; name: string }>;
      return rows.map((r) => ({
        id: r.id as SupplierId,
        name: r.name as SupplierName,
      }));
    },

    getSupplierById(id: string): SupplierRow | null {
      const row = db
        .prepare("SELECT * FROM suppliers WHERE id = ? LIMIT 1")
        .get(id) as SupplierRow | undefined;
      return row ?? null;
    },

    lookupSupplier(query: string): SupplierLookup {
      const trimmed = query.trim();
      const byId = db
        .prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'approved' LIMIT 1")
        .get(trimmed) as { id: string; name: string } | undefined;

      if (byId) {
        return {
          supplierId: byId.id as SupplierId,
          name: byId.name as SupplierName,
          confidence: 1,
        };
      }

      const byName = db
        .prepare("SELECT id, name FROM suppliers WHERE LOWER(name) = LOWER(?) AND status = 'approved' LIMIT 1")
        .get(trimmed) as { id: string; name: string } | undefined;

      if (byName) {
        return {
          supplierId: byName.id as SupplierId,
          name: byName.name as SupplierName,
          confidence: 1,
        };
      }

      return { notFound: true };
    },

    listSuppliers(status?: "approved" | "pending" | "removed"): SupplierRow[] {
      if (status) {
        return db
          .prepare("SELECT * FROM suppliers WHERE status = ? ORDER BY name ASC")
          .all(status) as SupplierRow[];
      }
      return db
        .prepare("SELECT * FROM suppliers ORDER BY name ASC")
        .all() as SupplierRow[];
    },
  };
}

export const rulesReadRepo = createRulesReadRepo;
