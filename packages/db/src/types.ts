import type { Actor, LogEntry, LogEvent, RuleCode, Rules } from "@shucamoxa/shared";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

export type ShucamoxaDb = BetterSqlite3Database;

export interface RulesRow {
  id: number;
  per_payment_cap_cents: number;
  total_budget_cents: number;
  period_start: string;
  kill_switch: number;
  updated_by: string;
  updated_at: string;
}

export interface SupplierRow {
  id: string;
  name: string;
  xrpl_address: string;
  destination_tag: number | null;
  status: "approved" | "pending" | "removed";
}

export interface ApprovalRow {
  id: string;
  kind: "supplier" | "payment";
  payload: string;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  invoice_number: string;
}

export interface ReservationRow {
  id: number;
  invoice_number: string;
  supplier_id: string;
  amount_cents: number;
  status: "reserved" | "settled" | "released";
  tx_hash: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: number;
  invoice_number: string;
  status: "settled" | "blocked" | "pending_approval" | "failed" | "unknown";
  rule_code: string;
  tx_hash: string | null;
  log_id: string;
  created_at: string;
}

export interface AuditLogRow {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  invoice_number: string | null;
  supplier_id: string | null;
  amount: string | null;
  rule_code: string | null;
  explanation: string;
  tx_hash: string | null;
  ledger_result: string | null;
  prev_hash: string;
  hash: string;
}

export interface ConsumedMemoHashRow {
  hash: string;
  invoice_number: string;
  consumed_at: string;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}
