import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/connection";
import { migrate } from "../src/migrate";
import { createLogRepo } from "../src/repos/log";
import { createPaymentsRepo } from "../src/repos/payments";
import { createReservationsRepo } from "../src/repos/reservations";
import { createRulesReadRepo } from "../src/repos/rules-read";
import { createRulesWriteRepo } from "../src/repos/rules-write";
import type { ShucamoxaDb } from "../src/types";

describe("T28 - Database Repositories", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-test-repos-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath);
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

  it("handles rules write and read repositories with budget calculations", () => {
    const rulesWrite = createRulesWriteRepo(db);
    const rulesRead = createRulesReadRepo(db);
    const reservations = createReservationsRepo(db);

    // Initial rules read before seeding is null
    expect(rulesRead.getRules()).toBeNull();

    // Set rules
    rulesWrite.setRules({
      perPaymentCapCents: 5000,
      totalBudgetCents: 20000,
      periodStart: "2026-11-01",
      killSwitch: false,
      updatedBy: "owner",
    });

    // Add suppliers
    rulesWrite.upsertSupplier({
      id: "sup_karoo",
      name: "Karoo Textiles",
      xrplAddress: "r3smzsz3bQWDc729AyEC51EaJjd5PanDM1",
      status: "approved",
    });

    rulesWrite.upsertSupplier({
      id: "sup_pending",
      name: "Pending Supplier",
      xrplAddress: "r3smzsz3bQWDc7zVez255vjGgBwCEyEyBn",
      status: "pending",
    });

    // Approved suppliers list only approved
    const approved = rulesRead.getApprovedSuppliers();
    expect(approved).toHaveLength(1);
    expect(approved[0]?.id).toBe("sup_karoo");

    // Lookup supplier
    expect(rulesRead.lookupSupplier("sup_karoo")).toEqual({
      supplierId: "sup_karoo",
      name: "Karoo Textiles",
      confidence: 1,
    });
    expect(rulesRead.lookupSupplier("Karoo Textiles")).toEqual({
      supplierId: "sup_karoo",
      name: "Karoo Textiles",
      confidence: 1,
    });
    expect(rulesRead.lookupSupplier("Unknown Co")).toEqual({ notFound: true });

    // Initial budget calculation
    let rules = rulesRead.getRules();
    expect(rules?.spent).toBe("0.00");
    expect(rules?.reserved).toBe("0.00");
    expect(rules?.remaining).toBe("200.00");

    // Reserve 30.00 (3000 cents)
    reservations.createReservation({
      invoiceNumber: "INV-100",
      supplierId: "sup_karoo",
      amountCents: 3000,
      status: "reserved",
    });

    rules = rulesRead.getRules();
    expect(rules?.spent).toBe("0.00");
    expect(rules?.reserved).toBe("30.00");
    expect(rules?.remaining).toBe("170.00");

    // Settle 30.00
    reservations.settleReservation("INV-100", "a".repeat(64));

    rules = rulesRead.getRules();
    expect(rules?.spent).toBe("30.00");
    expect(rules?.reserved).toBe("0.00");
    expect(rules?.remaining).toBe("170.00");

    // Kill switch toggle
    rulesWrite.setKillSwitch(true, "owner");
    rules = rulesRead.getRules();
    expect(rules?.killSwitch).toBe(true);
  });

  it("handles approvals workflow", () => {
    const rulesWrite = createRulesWriteRepo(db);

    rulesWrite.createApproval({
      id: "appr_01",
      kind: "supplier",
      payload: { name: "New Supplier", invoiceNumber: "INV-200" },
      invoiceNumber: "INV-200",
    });

    const appr = rulesWrite.getApproval("appr_01");
    expect(appr).toBeDefined();
    expect(appr?.status).toBe("pending");
    expect(appr?.decided_by).toBeNull();

    rulesWrite.decideApproval("appr_01", "approved", "owner");
    const decided = rulesWrite.getApproval("appr_01");
    expect(decided?.status).toBe("approved");
    expect(decided?.decided_by).toBe("owner");
    expect(decided?.decided_at).toBeDefined();
  });

  it("handles payments repository and memo hash consumption", () => {
    const paymentsRepo = createPaymentsRepo(db);

    const payment = paymentsRepo.recordPayment({
      invoiceNumber: "INV-300",
      status: "settled",
      ruleCode: "OK",
      txHash: "f".repeat(64),
      logId: "log_123",
    });

    expect(payment.id).toBeGreaterThan(0);
    expect(payment.status).toBe("settled");

    const fetched = paymentsRepo.getPaymentByInvoice("INV-300");
    expect(fetched?.rule_code).toBe("OK");
    expect(fetched?.tx_hash).toBe("f".repeat(64));

    const hash = "e".repeat(64);
    expect(paymentsRepo.isMemoHashConsumed(hash)).toBe(false);

    paymentsRepo.consumeMemoHash(hash, "INV-300");
    expect(paymentsRepo.isMemoHashConsumed(hash)).toBe(true);

    // Attempting to consume same hash throws UNIQUE constraint
    expect(() => paymentsRepo.consumeMemoHash(hash, "INV-300")).toThrow();
  });

  it("handles audit log repository and chain verification", async () => {
    const logRepo = createLogRepo(db);

    await logRepo.appendLog({
      actor: "system",
      event: "rules_changed",
      explanation: "Initial rules setup",
    });

    await logRepo.appendLog({
      actor: "agent",
      event: "invoice_received",
      invoiceNumber: "INV-400",
      explanation: "Invoice INV-400 received",
    });

    await logRepo.appendLog({
      actor: "payment",
      event: "payment_settled",
      invoiceNumber: "INV-400",
      ruleCode: "OK",
      explanation: "Payment settled on XRPL",
      txHash: "1".repeat(64),
      ledgerResult: "tesSUCCESS",
    });

    const entries = logRepo.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.seq).toBe(1);
    expect(entries[1]?.seq).toBe(2);
    expect(entries[2]?.seq).toBe(3);

    // Verify hash chain
    const verification = logRepo.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.failedSeq).toBeNull();
  });
});
