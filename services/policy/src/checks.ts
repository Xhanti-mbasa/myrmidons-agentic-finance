import type { ReservationsRepo, ShucamoxaDb } from "@shucamoxa/db";
import {
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  toCents,
  toHex,
  type CosignRequest,
  type RuleCode,
  type Rules,
} from "@shucamoxa/shared";

export interface PolicySupplier {
  id: string;
  name?: string;
  address?: string;
  xrpl_address?: string;
  destinationTag?: number | null;
  destination_tag?: number | null;
  status?: "approved" | "pending" | "removed" | string;
}

export type PolicyRules = Omit<Rules, "suppliers"> & {
  suppliers?: readonly (Rules["suppliers"][number] | PolicySupplier)[];
};

export type PolicyCheckContext = {
  decodedTx: Record<string, unknown>;
  request: CosignRequest;
  rules: PolicyRules | Rules;
  treasuryAccount: string;
  agentAccount: string;
  getSupplier?: (id: string) => PolicySupplier | null | undefined;
  db?: ShucamoxaDb;
  reservationsRepo?: ReservationsRepo;
};

export type PolicyCheck = (ctx: PolicyCheckContext) => RuleCode | null;

/** Maximum allowable transaction fee drops on Testnet (1,000 drops). */
export const MAX_FEE_DROPS = 1000n;

/** XRPL tfFullyCanonicalSig flag constant (0x80000000 = 2147483648). */
export const TF_FULLY_CANONICAL_SIG = 0x80000000;

/** Allowlist of permitted top-level fields on Payment transactions. */
export const ALLOWED_TX_FIELDS: ReadonlySet<string> = new Set([
  "TransactionType",
  "Account",
  "Destination",
  "DestinationTag",
  "Amount",
  "Fee",
  "Sequence",
  "LastLedgerSequence",
  "Flags",
  "Memos",
  "SigningPubKey",
  "NetworkID",
  "Signers",
]);

/**
 * Resolves a supplier from the rules store (either via getSupplier or rules.suppliers).
 * Rules are always read from the store, never from the client request.
 */
export function findSupplier(ctx: PolicyCheckContext, supplierId: string): PolicySupplier | null {
  if (ctx.getSupplier) {
    const s = ctx.getSupplier(supplierId);
    if (s) return s;
  }
  const found = ctx.rules.suppliers?.find((s) => s.id === supplierId);
  return (found as PolicySupplier) ?? null;
}

/** Check 1: Kill switch is off. */
export const checkKillSwitch: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  if (ctx.rules.killSwitch) {
    return "KILL_SWITCH_ON";
  }
  return null;
};

/** Check 2: TransactionType is Payment and Account is the treasury. */
export const checkPaymentFromTreasury: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  if (ctx.decodedTx.TransactionType !== "Payment" || ctx.decodedTx.Account !== ctx.treasuryAccount) {
    return "FORBIDDEN_TX_FIELDS";
  }
  return null;
};

/** Check 3: supplierId is approved and active in the rules store. */
export const checkApprovedSupplier: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const supplierId = ctx.request.request.supplierId;
  const supplier = findSupplier(ctx, supplierId);
  if (!supplier || supplier.status !== "approved") {
    return "SUPPLIER_NOT_APPROVED";
  }
  return null;
};

/** Check 4: Destination (and DestinationTag if set) equals that supplier's approved address. */
export const checkDestination: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const supplierId = ctx.request.request.supplierId;
  const supplier = findSupplier(ctx, supplierId);
  if (!supplier) {
    return "SUPPLIER_NOT_APPROVED";
  }

  const expectedAddress = supplier.address ?? supplier.xrpl_address;
  if (!expectedAddress || ctx.decodedTx.Destination !== expectedAddress) {
    return "DESTINATION_MISMATCH";
  }

  const supplierTagRaw = supplier.destinationTag ?? supplier.destination_tag;
  const hasSupplierTag = supplierTagRaw !== undefined && supplierTagRaw !== null;

  const txTagRaw = ctx.decodedTx.DestinationTag;
  const hasTxTag = txTagRaw !== undefined && txTagRaw !== null;

  if (hasSupplierTag) {
    if (!hasTxTag || Number(txTagRaw) !== Number(supplierTagRaw)) {
      return "DESTINATION_MISMATCH";
    }
  } else {
    if (hasTxTag) {
      return "DESTINATION_MISMATCH";
    }
  }

  return null;
};

/** Check 5: Amount is an object with RLUSD currency hex and the testnet RLUSD issuer, and equals request.amount. */
export const checkAssetAndAmount: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const amount = ctx.decodedTx.Amount;
  if (!amount || typeof amount !== "object" || Array.isArray(amount)) {
    return "WRONG_ASSET";
  }

  const { currency, issuer, value } = amount as Record<string, unknown>;

  if (currency !== RLUSD_CURRENCY_HEX) {
    return "WRONG_ASSET";
  }

  if (issuer !== RLUSD_TESTNET_ISSUER) {
    return "WRONG_ASSET";
  }

  if (typeof value !== "string") {
    return "WRONG_ASSET";
  }

  let txAmountCents: bigint;
  try {
    txAmountCents = toCents(value);
  } catch {
    return "WRONG_ASSET";
  }

  let requestAmountCents: bigint;
  try {
    requestAmountCents = toCents(ctx.request.request.amount);
  } catch {
    return "WRONG_ASSET";
  }

  if (txAmountCents !== requestAmountCents) {
    return "WRONG_ASSET";
  }

  return null;
};

/** Check 6: Field allowlist, Flags only 0 or tfFullyCanonicalSig, SigningPubKey = "", Fee <= 1000 drops. */
export const checkTransactionFieldsAndFee: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const tx = ctx.decodedTx;

  // 1. Allowlist check: any extra field -> FORBIDDEN_TX_FIELDS
  for (const key of Object.keys(tx)) {
    if (tx[key] !== undefined && !ALLOWED_TX_FIELDS.has(key)) {
      return "FORBIDDEN_TX_FIELDS";
    }
  }

  // 2. SigningPubKey must be empty string in multisign tx
  if (tx.SigningPubKey !== "") {
    return "FORBIDDEN_TX_FIELDS";
  }

  // 3. Flags only 0 or tfFullyCanonicalSig (or omitted)
  const flags = tx.Flags;
  if (
    flags !== undefined &&
    flags !== 0 &&
    flags !== TF_FULLY_CANONICAL_SIG &&
    flags !== 2147483648
  ) {
    return "FORBIDDEN_TX_FIELDS";
  }

  // 4. Fee check: Fee at most MAX_FEE_DROPS (1,000 drops)
  if (tx.Fee === undefined || tx.Fee === null) {
    return "FORBIDDEN_TX_FIELDS";
  }
  const feeStr = String(tx.Fee);
  if (!/^\d+$/.test(feeStr)) {
    return "FORBIDDEN_TX_FIELDS";
  }
  try {
    const feeDrops = BigInt(feeStr);
    if (feeDrops < 0n || feeDrops > MAX_FEE_DROPS) {
      return "FORBIDDEN_TX_FIELDS";
    }
  } catch {
    return "FORBIDDEN_TX_FIELDS";
  }

  return null;
};

/** Check 7: Amount is at or below the per-payment cap. */
export const checkPerPaymentCap: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const amount = ctx.decodedTx.Amount;
  if (!amount || typeof amount !== "object" || Array.isArray(amount)) {
    return "WRONG_ASSET";
  }

  const { value } = amount as Record<string, unknown>;
  if (typeof value !== "string") {
    return "WRONG_ASSET";
  }

  let txAmountCents: bigint;
  try {
    txAmountCents = toCents(value);
  } catch {
    return "WRONG_ASSET";
  }

  let capCents: bigint;
  try {
    capCents = toCents(ctx.rules.perPaymentCap);
  } catch {
    return "OVER_PER_PAYMENT_CAP";
  }

  if (txAmountCents > capCents) {
    return "OVER_PER_PAYMENT_CAP";
  }

  return null;
};

/** Memo structure check: exactly one memo, MemoType = toHex(MEMO_TYPE), MemoData 64 hex characters, no MemoFormat. */
export const checkMemoStructure: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const memos = ctx.decodedTx.Memos;
  if (!Array.isArray(memos) || memos.length !== 1) {
    return "MEMO_MISMATCH";
  }

  const memoWrapper = memos[0];
  if (!memoWrapper || typeof memoWrapper !== "object" || !("Memo" in memoWrapper)) {
    return "MEMO_MISMATCH";
  }

  const memo = (memoWrapper as Record<string, unknown>).Memo;
  if (!memo || typeof memo !== "object") {
    return "MEMO_MISMATCH";
  }

  const memoObj = memo as Record<string, unknown>;

  // No MemoFormat allowed
  if ("MemoFormat" in memoObj && memoObj.MemoFormat !== undefined) {
    return "MEMO_MISMATCH";
  }

  // MemoType must equal toHex(MEMO_TYPE)
  const expectedMemoType = toHex(MEMO_TYPE);
  if (
    typeof memoObj.MemoType !== "string" ||
    memoObj.MemoType.toUpperCase() !== expectedMemoType.toUpperCase()
  ) {
    return "MEMO_MISMATCH";
  }

  // MemoData must be exactly 64 hex characters
  if (
    typeof memoObj.MemoData !== "string" ||
    !/^[0-9A-Fa-f]{64}$/.test(memoObj.MemoData)
  ) {
    return "MEMO_MISMATCH";
  }

  // Reject any unexpected fields in the memo object
  for (const key of Object.keys(memoObj)) {
    if (key !== "MemoType" && key !== "MemoData") {
      return "MEMO_MISMATCH";
    }
  }

  return null;
};

/**
 * Check 8: Invoice number must not already be in reservations with a settled payment
 * or an active reservation for another hash.
 */
export const checkDuplicateInvoice: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  const invoiceNumber = ctx.request.request.invoiceNumber;
  const currentHash = ctx.request.request.logEntryHash;

  let activeReservation: { status: string; tx_hash: string | null } | null = null;

  if (ctx.reservationsRepo) {
    const row = ctx.reservationsRepo.getActiveReservation(invoiceNumber);
    if (row) {
      activeReservation = { status: row.status, tx_hash: row.tx_hash };
    }
  } else if (ctx.db) {
    const row = ctx.db
      .prepare(
        "SELECT status, tx_hash FROM reservations WHERE invoice_number = ? AND status IN ('reserved', 'settled') ORDER BY id DESC LIMIT 1"
      )
      .get(invoiceNumber) as { status: string; tx_hash: string | null } | undefined;
    if (row) {
      activeReservation = row;
    }
  }

  if (activeReservation) {
    if (activeReservation.status === "settled") {
      return "DUPLICATE_INVOICE";
    }
    if (activeReservation.status === "reserved" && activeReservation.tx_hash !== currentHash) {
      return "DUPLICATE_INVOICE";
    }
  }

  return null;
};

/**
 * Check 9: Total spent + reserved + requested amount must not exceed totalBudget.
 */
export const checkOverBudget: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  let requestedCents: bigint;
  try {
    requestedCents = toCents(ctx.request.request.amount);
  } catch {
    return "WRONG_ASSET";
  }

  let totalBudgetCents: bigint;
  try {
    totalBudgetCents = toCents(ctx.rules.totalBudget);
  } catch {
    return "OVER_BUDGET";
  }

  let spentCents = 0n;
  let reservedCents = 0n;

  if (ctx.reservationsRepo) {
    spentCents = BigInt(ctx.reservationsRepo.getTotalSettledCents());
    reservedCents = BigInt(ctx.reservationsRepo.getTotalReservedCents());
  } else if (ctx.db) {
    const spentRow = ctx.db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM reservations WHERE status = 'settled'")
      .get() as { total: number };
    const reservedRow = ctx.db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM reservations WHERE status = 'reserved'")
      .get() as { total: number };
    spentCents = BigInt(spentRow.total);
    reservedCents = BigInt(reservedRow.total);
  } else {
    try {
      spentCents = toCents(ctx.rules.spent ?? "0.00");
    } catch {}
    try {
      reservedCents = toCents(ctx.rules.reserved ?? "0.00");
    } catch {}
  }

  // If this invoice already has an active reservation for the exact same hash (idempotent retry),
  // its amount is already included in reservedCents.
  let isSameReservationRetry = false;
  const invoiceNumber = ctx.request.request.invoiceNumber;
  const currentHash = ctx.request.request.logEntryHash;

  if (ctx.reservationsRepo) {
    const row = ctx.reservationsRepo.getActiveReservation(invoiceNumber);
    if (row && row.status === "reserved" && row.tx_hash === currentHash) {
      isSameReservationRetry = true;
    }
  } else if (ctx.db) {
    const row = ctx.db
      .prepare(
        "SELECT status, tx_hash FROM reservations WHERE invoice_number = ? AND status = 'reserved' LIMIT 1"
      )
      .get(invoiceNumber) as { status: string; tx_hash: string | null } | undefined;
    if (row && row.tx_hash === currentHash) {
      isSameReservationRetry = true;
    }
  }

  const effectiveNewAmount = isSameReservationRetry ? 0n : requestedCents;
  if (spentCents + reservedCents + effectiveNewAmount > totalBudgetCents) {
    return "OVER_BUDGET";
  }

  return null;
};

/** Helper to run an array of policy checks in order, first failure wins. */
export function runPolicyChecks(
  ctx: PolicyCheckContext,
  checks: readonly PolicyCheck[] = DEFAULT_POLICY_CHECKS
): RuleCode | null {
  for (const check of checks) {
    const failure = check(ctx);
    if (failure !== null) {
      return failure;
    }
  }
  return null;
}

/** Ordered check pipeline for T22. Ships checks 1 to 7 plus duplicate, budget, and memo structure. */
export const DEFAULT_POLICY_CHECKS: readonly PolicyCheck[] = [
  checkKillSwitch,
  checkPaymentFromTreasury,
  checkApprovedSupplier,
  checkDestination,
  checkAssetAndAmount,
  checkTransactionFieldsAndFee,
  checkPerPaymentCap,
  checkDuplicateInvoice,
  checkOverBudget,
  checkMemoStructure,
];
