import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { attack } from "./harness";
import { fixture, owner, agent } from "./fixture";
import { verifyTransferAudit } from "../services/payments/src/payment";
import { auditHashInput, GENESIS_HASH, hashLogEntry, verifyChain, type LogEntry } from "../packages/shared/src/index";
const standard = "ASVS5 v16.4.2, v16.4.3";
for (const mutation of ["edit", "delete-middle", "reorder"] as const) {
  attack(`AUDIT-${{edit:"01", "delete-middle":"02", reorder:"03"}[mutation]}`, `Transfer audit ${mutation}`,
    "payment audit gate", standard, "BLOCKED", "simulated test (real SQLite)", async () => {
    const f = fixture(), intentId = f.create(), entries = f.service.audit(owner);
    if (mutation === "edit") entries[0]!.event = "forged";
    if (mutation === "delete-middle") entries.splice(1, 1);
    if (mutation === "reorder") [entries[0], entries[1]] = [entries[1]!, entries[0]!];
    expect(verifyTransferAudit(entries)).toBe(false);
    const db = new DatabaseSync(f.path); db.exec("DELETE FROM audit");
    // SQL order is authoritative; reorder the stored bodies while retaining ordering keys.
    entries.forEach((entry, i) => db.prepare("INSERT INTO audit VALUES(?,?,?)").run(owner.ownerId, i + 1, JSON.stringify(entry)));
    db.close();
    let error = ""; try { await f.service.pay(agent, { intentId }); } catch (e) { error = (e as Error).message; }
    return { safe: error === "AUDIT_UNAVAILABLE" && !f.wallet.submit.mock.calls.length, observation: "Malformed history blocks payment before adapter use" };
  });
}
for (const [id, mutation] of [["AUDIT-04", "truncate"], ["AUDIT-05", "rewrite"], ["AUDIT-06", "erase"]] as const) {
  attack(id, `DB writer ${mutation}s transfer audit`, "payment audit gate", standard, "VULNERABLE",
    "simulated test (real SQLite; simulated policy/wallet)", async () => {
    const f = fixture(), intentId = f.create(); let entries = f.service.audit(owner);
    if (mutation === "truncate") entries.pop();
    if (mutation === "erase") entries = [];
    if (mutation === "rewrite") {
      entries[0]!.details.address = "forged-history";
      let previous = GENESIS_HASH;
      entries = entries.map(({ hash: _hash, ...entry }) => {
        entry.prevHash = previous;
        const hash = createHash("sha256").update(auditHashInput(previous, entry)).digest("hex");
        previous = hash; return { ...entry, hash };
      });
    }
    const db = new DatabaseSync(f.path); db.exec("DELETE FROM audit");
    entries.forEach(entry => db.prepare("INSERT INTO audit VALUES(?,?,?)").run(owner.ownerId, entry.seq, JSON.stringify(entry)));
    db.close();
    const result = await f.service.pay(agent, { intentId });
    return { safe: result.status !== "settled" && !f.wallet.submit.mock.calls.length,
      observation: `Modified history accepted and wallet invoked after ${mutation}; attacker has DB write access, not merely agent bearer token` };
  });
}
async function sharedLog() {
  let previous = GENESIS_HASH; const entries: LogEntry[] = [];
  for (let seq = 1; seq <= 3; seq++) {
    const entry: Omit<LogEntry, "hash"> = { seq, ts: "2026-11-13T00:00:00Z", actor: "payment",
      event: "payment_requested", invoiceNumber: "INV-1", supplierId: "sup_vendor", amount: "1.00",
      ruleCode: null, explanation: "Request", txHash: null, ledgerResult: null, prevHash: previous };
    previous = await hashLogEntry(previous, entry); entries.push({ ...entry, hash: previous });
  }
  expect(await verifyChain(entries)).toBeNull(); return entries;
}
attack("AUDIT-07", "Shared log edit, middle deletion and reordering", "shared log.ts", standard, "BLOCKED", "simulated test", async () => {
  const original = await sharedLog();
  const edit = structuredClone(original); edit[0]!.amount = "2.00";
  return { safe: (await verifyChain(edit)) !== null && (await verifyChain([original[0]!, original[2]!])) !== null &&
    (await verifyChain([original[1]!, original[0]!, original[2]!])) !== null, observation: "All three inconsistent histories rejected" };
});
attack("AUDIT-08", "Shared log suffix deletion and complete recomputation", "shared log.ts", standard, "VULNERABLE", "simulated test", async () => {
  const entries = await sharedLog(); const truncatedAccepted = await verifyChain(entries.slice(0, -1)) === null;
  let previous = GENESIS_HASH;
  for (const entry of entries) {
    entry.amount = "2.00"; entry.prevHash = previous;
    const { hash: _hash, ...rest } = entry; entry.hash = await hashLogEntry(previous, rest); previous = entry.hash;
  }
  return { safe: !truncatedAccepted && await verifyChain(entries) !== null,
    observation: "Valid prefix and entirely recomputed history both verify; no external checkpoint supplied" };
});
