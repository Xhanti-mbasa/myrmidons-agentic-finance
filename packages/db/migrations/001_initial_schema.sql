-- Shucamoxa initial database schema (T28)
-- All money amounts stored as integer cents with positive CHECK constraints.
-- Enforced append-only audit log with triggers.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  per_payment_cap_cents INTEGER NOT NULL CHECK (per_payment_cap_cents > 0),
  total_budget_cents INTEGER NOT NULL CHECK (total_budget_cents > 0),
  period_start TEXT NOT NULL,
  kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  xrpl_address TEXT NOT NULL CHECK (length(xrpl_address) BETWEEN 25 AND 35 AND xrpl_address LIKE 'r%'),
  destination_tag INTEGER CHECK (destination_tag IS NULL OR (destination_tag >= 0 AND destination_tag <= 4294967295)),
  status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'removed'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('supplier', 'payment')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT,
  decided_at TEXT,
  invoice_number TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_active_invoice
ON reservations(invoice_number)
WHERE status IN ('reserved', 'settled');

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('settled', 'blocked', 'pending_approval', 'failed', 'unknown')),
  rule_code TEXT NOT NULL,
  tx_hash TEXT,
  log_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('agent', 'payment', 'policy', 'owner', 'system')),
  event TEXT NOT NULL CHECK (event IN (
    'invoice_received',
    'invoice_extracted',
    'payment_requested',
    'policy_allowed',
    'policy_blocked',
    'payment_settled',
    'payment_failed',
    'approval_requested',
    'approval_decided',
    'rules_changed',
    'kill_switch_on',
    'kill_switch_off',
    'signer_list_changed'
  )),
  invoice_number TEXT,
  rule_code TEXT,
  explanation TEXT NOT NULL,
  tx_hash TEXT,
  ledger_result TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE forbidden');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: DELETE forbidden');
END;

CREATE TABLE IF NOT EXISTS consumed_memo_hashes (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
  invoice_number TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
