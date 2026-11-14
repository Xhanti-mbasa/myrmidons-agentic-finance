import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { PaymentService, paymentDigest, verifyTransferAudit, type PaymentAdapters, type Principal } from "../src/payment";
import { createSignedPolicyAdapter, createGuardedWalletAdapter } from "../src/signing";
import { createTransferServer } from "../src/http";
import { RLUSD_TESTNET_ISSUER, TransferResult } from "../../../packages/shared/src/index";

const owner: Principal = { ownerId: "business", subjectId: "owner", role: "owner" };
const agent: Principal = { ownerId: "business", subjectId: "agent", role: "agent" };
const other: Principal = { ownerId: "other", subjectId: "agent", role: "agent" };
const source = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const reserve = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";
const rules = { enabled: true, perPaymentCap: "500.00", totalBudget: "2000.00", recipientCaps: { johnson: "1000.00" } };
const txHash = "A".repeat(64);
const settled = (digest: string) => ({ status: "settled", paymentDigest: digest, txHash,
  validated: true, ledgerIndex: 100, ledgerResult: "tesSUCCESS" });
const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "shucamoxa-pay-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "payments.sqlite");
  let time = Date.parse("2026-11-13T00:00:00Z");
  const policy = { authorize: vi.fn<PaymentAdapters["policy"]["authorize"]>(async (_payment, digest) => ({ decision: "allow", paymentDigest: digest, authorization: "fake-test-permit" })) };
  const wallet = {
    submit: vi.fn<PaymentAdapters["wallet"]["submit"]>(async (_payment, permit) => settled(permit.paymentDigest)),
    lookup: vi.fn<PaymentAdapters["wallet"]["lookup"]>(async (_payment, digest) => settled(digest)),
  };
  const adapters: PaymentAdapters = { policy, wallet };
  const service = new PaymentService(path, adapters, () => new Date(time));
  let closed = false;
  cleanups.push(() => { if (!closed) service.close(); });
  service.registerAccount(owner, { id: "treasury", address: source });
  service.registerAccount(owner, { id: "reserve", address: reserve });
  service.approveRecipient(owner, { id: "johnson", kind: "person", address: RLUSD_TESTNET_ISSUER, destinationTag: 0 });
  service.approveRecipient(owner, { id: "vendor", kind: "vendor", address: reserve });
  service.approveRecipient(owner, { id: "internal", kind: "internal", accountId: "reserve" });
  service.setPolicy(owner, rules);
  const input = (extra = {}) => ({ sourceAccountId: "treasury", recipientId: "johnson", amount: "100.00",
    reference: "PAY-1", executeAt: null, expiresAt: "2026-11-14T00:00:00Z", ...extra });
  const create = (extra = {}) => service.createIntent(owner, input(extra)).intentId;
  const reopen = () => {
    service.close(); closed = true;
    const next = new PaymentService(path, adapters, () => new Date(time));
    cleanups.push(() => next.close()); return next;
  };
  return { service, path, policy, wallet, input, create, reopen, advance: (ms: number) => { time += ms; } };
}

describe("deterministic pay tool", () => {
  it("uses real signed permits against durable current authority and refuses replay after settlement", async () => {
    const f = fixture(), id = f.create(), keys = generateKeyPairSync("ed25519");
    const check = async (payment: Parameters<typeof paymentDigest>[0]) => f.service.checkSigningBoundary(payment);
    const clock = () => new Date("2026-11-13T00:00:00Z");
    const policy = createSignedPolicyAdapter(keys.privateKey, check, clock);
    const rawSubmit = vi.fn(f.wallet.submit.getMockImplementation()!);
    const guarded = createGuardedWalletAdapter(keys.publicKey, check,
      { submit: rawSubmit, lookup: f.wallet.lookup }, clock);
    f.policy.authorize.mockImplementation(policy.authorize);
    f.wallet.submit.mockImplementation(guarded.submit);
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("settled");
    const [prepared, permit] = f.wallet.submit.mock.calls[0]!;
    await expect(guarded.submit(prepared, permit)).rejects.toThrow("POLICY_DENIED");
    expect(rawSubmit).toHaveBeenCalledTimes(1);
  });

  it("rejects contradictory public outcomes and settlement without a hash", () => {
    const base = { intentId: "ad2ae810-0787-49f2-a458-1c57bff0fb11" };
    expect(TransferResult.safeParse({ ...base, status: "settled", code: "OK" }).success).toBe(false);
    expect(TransferResult.safeParse({ ...base, status: "blocked", code: "OK" }).success).toBe(false);
    expect(TransferResult.safeParse({ ...base, status: "unknown", code: "OK" }).success).toBe(false);
    expect(TransferResult.safeParse({ ...base, status: "settled", code: "POLICY_DENIED", txHash }).success).toBe(false);
  });
  it("executes the exact owner-authorized intent and audits before signing", async () => {
    const f = fixture(), id = f.create();
    const result = await f.service.pay(agent, { intentId: id });
    expect(result).toEqual({ intentId: id, status: "settled", code: "OK", txHash });
    const [payment, permit] = f.wallet.submit.mock.calls[0]!;
    expect(payment).toMatchObject({ sourceAddress: source, destination: RLUSD_TESTNET_ISSUER,
      destinationTag: 0, amount: "100.00", recipientKind: "person" });
    expect(permit.paymentDigest).toBe(paymentDigest(payment));
    expect(f.service.budget(owner)).toEqual({ spent: "100.00", reserved: "0.00" });
    const audit = f.service.audit(owner);
    expect(audit.map(e => e.event)).toContain("submission_started");
    expect(audit.findIndex(e => e.event === "submission_started")).toBeLessThan(audit.findIndex(e => e.event === "payment_settled"));
    expect(verifyTransferAudit(audit)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("fake-test-permit");
    audit[0]!.event = "tampered";
    expect(verifyTransferAudit(audit)).toBe(false);
  });

  it.each(["internal", "vendor"])("uses approved %s destinations", async recipientId => {
    const f = fixture(); const id = f.create({ recipientId });
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("settled");
    expect(f.wallet.submit.mock.calls[0]![0]).toMatchObject({ recipientKind: recipientId, destination: reserve });
  });

  it("rejects agent-created authority, owner mutations, forged scope and raw destination arguments", async () => {
    const f = fixture(), id = f.create();
    expect(() => f.service.createIntent(agent, f.input())).toThrow("NOT_AUTHORIZED");
    expect(() => f.service.setPolicy(agent, rules)).toThrow("NOT_AUTHORIZED");
    expect(() => f.service.approveRecipient(agent, { id: "hacker" })).toThrow("NOT_AUTHORIZED");
    await expect(f.service.pay(agent, { intentId: id, destination: reserve })).rejects.toThrow("INVALID_REQUEST");
    expect((await f.service.pay(other, { intentId: id })).code).toBe("NOT_AUTHORIZED");
    expect(() => f.service.getStatus(other, id)).toThrow("NOT_AUTHORIZED");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("refuses invisible characters, SQL text and amount overrides without interpreting them", async () => {
    const f = fixture(), id = f.create();
    for (const input of [{ intentId: id + "\u200b" }, { intentId: "'; DROP TABLE intents;--" }, { intentId: id, amount: "1" }])
      await expect(f.service.pay(agent, input)).rejects.toThrow("INVALID_REQUEST");
    expect(f.service.getStatus(owner, id).status).toBe("created");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("locks only the offending principal's payment authority and requires owner unlock", async () => {
    const f = fixture(), id = f.create();
    for (let n = 0; n < 5; n++) await expect(f.service.pay(agent, { intentId: "bad" })).rejects.toThrow("INVALID_REQUEST");
    await expect(f.service.pay(agent, { intentId: id })).rejects.toThrow("AUTHORITY_LOCKED");
    expect(() => f.service.unlock(agent, "agent")).toThrow("NOT_AUTHORIZED");
    f.service.unlock(owner, "agent");
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("settled");
  });

  it("applies recipient cap overrides while preserving the global budget", async () => {
    const f = fixture();
    const allowed = f.create({ amount: "750", reference: "PAY-ALLOW" });
    const denied = f.create({ recipientId: "vendor", amount: "750", reference: "PAY-DENY" });
    expect((await f.service.pay(agent, { intentId: allowed })).status).toBe("settled");
    expect((await f.service.pay(agent, { intentId: denied })).code).toBe("OVER_PER_PAYMENT_CAP");
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("uses a stricter recipient override and admits the exact cumulative budget boundary", async () => {
    const f = fixture();
    f.service.setPolicy(owner, { ...rules, totalBudget: "100.00", recipientCaps: { johnson: "40.00" } });
    const over = f.create({ amount: "40.01", reference: "STRICT-OVER" });
    expect((await f.service.pay(agent, { intentId: over })).code).toBe("OVER_PER_PAYMENT_CAP");
    const a = f.create({ amount: "40.00", reference: "EXACT-A" });
    const b = f.create({ amount: "60.00", recipientId: "vendor", reference: "EXACT-B" });
    expect((await f.service.pay(agent, { intentId: a })).status).toBe("settled");
    expect((await f.service.pay(agent, { intentId: b })).status).toBe("settled");
    const c = f.create({ amount: "0.01", reference: "FIRST-OVER" });
    expect((await f.service.pay(agent, { intentId: c })).code).toBe("OVER_BUDGET");
    expect(f.service.budget(owner)).toEqual({ spent: "100.00", reserved: "0.00" });
    expect(f.wallet.submit).toHaveBeenCalledTimes(2);
  });

  it("preserves spent plus unknown reservations through policy edits and restart without rollover", async () => {
    const f = fixture();
    const a = f.create({ amount: "40.00", reference: "SPENT" });
    expect((await f.service.pay(agent, { intentId: a })).status).toBe("settled");
    f.wallet.submit.mockRejectedValueOnce(new Error("uncertain broadcast"));
    const b = f.create({ amount: "60.00", reference: "RESERVED" });
    expect((await f.service.pay(agent, { intentId: b })).status).toBe("unknown");
    f.service.setPolicy(owner, { ...rules, totalBudget: "100.00" });
    expect(f.service.budget(owner)).toEqual({ spent: "40.00", reserved: "60.00" });
    f.advance(8 * 86400000);
    const next = f.reopen();
    expect(next.budget(owner)).toEqual({ spent: "40.00", reserved: "60.00" });
    const c = next.createIntent(owner, f.input({ amount: "0.01", reference: "NO-ROLLOVER",
      expiresAt: "2026-12-01T00:00:00Z" })).intentId;
    expect((await next.pay(agent, { intentId: c })).code).toBe("OVER_BUDGET");
    expect((await next.pay(agent, { intentId: b })).status).toBe("unknown");
    expect(f.wallet.submit).toHaveBeenCalledTimes(2);
    expect((await next.reconcile(agent, b)).status).toBe("settled");
    expect(next.budget(owner)).toEqual({ spent: "100.00", reserved: "0.00" });
  });

  it("counts in-flight reservations across independent connections for different intents", async () => {
    const f = fixture();
    f.service.setPolicy(owner, { ...rules, totalBudget: "100.00" });
    const a = f.create(), b = f.create({ amount: "0.01", reference: "OTHER-CONNECTION" });
    let release!: (value: unknown) => void;
    f.policy.authorize.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.service.pay(agent, { intentId: a });
    const second = new PaymentService(f.path, { policy: f.policy, wallet: f.wallet }, () => new Date("2026-11-13T00:00:00Z"));
    try {
      expect((await second.pay(agent, { intentId: b })).code).toBe("OVER_BUDGET");
      expect(second.budget(owner)).toEqual({ spent: "0.00", reserved: "100.00" });
    } finally { second.close(); }
    const payment = f.policy.authorize.mock.calls[0]![0];
    release({ decision: "allow", paymentDigest: paymentDigest(payment), authorization: "test" });
    expect((await pending).status).toBe("settled");
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("blocks an enabled policy edit while authorization is pending and releases only the unsubmitted reservation", async () => {
    const f = fixture(), id = f.create();
    f.policy.authorize.mockImplementationOnce(async (_payment, digest) => {
      f.service.setPolicy(owner, { ...rules, perPaymentCap: "1.00", recipientCaps: {} });
      return { decision: "allow", paymentDigest: digest, authorization: "test" };
    });
    expect((await f.service.pay(agent, { intentId: id })).code).toBe("POLICY_CHANGED");
    expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "0.00" });
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("disabling stops new authority without releasing a previously uncertain submission", async () => {
    const f = fixture(), id = f.create();
    f.wallet.submit.mockRejectedValueOnce(new Error("uncertain broadcast"));
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("unknown");
    const fresh = f.create({ amount: "1.00", reference: "DISABLED" });
    f.service.setPolicy(owner, { ...rules, enabled: false });
    expect((await f.service.pay(agent, { intentId: fresh })).code).toBe("KILL_SWITCH_ON");
    expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "100.00" });
    expect((await f.service.reconcile(agent, id)).status).toBe("settled");
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("never rebinds an approved intent after a directory address changes", async () => {
    const f = fixture(), id = f.create();
    f.service.approveRecipient(owner, { id: "johnson", kind: "person", address: reserve });
    expect((await f.service.pay(agent, { intentId: id })).code).toBe("INTENT_MISMATCH");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("deduplicates equivalent amounts and refuses conflicting/cross-account intent replacement", () => {
    const f = fixture(), id = f.create({ amount: "100" });
    expect(f.create({ amount: "100.00" })).toBe(id);
    expect(() => f.create({ amount: "101" })).toThrow("INTENT_MISMATCH");
    expect(() => f.create({ sourceAccountId: "reserve" })).toThrow("INTENT_MISMATCH");
  });

  it("deduplicates concurrent requests across two connections and after restart", async () => {
    const f = fixture(), id = f.create();
    let release!: (value: unknown) => void;
    f.policy.authorize.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }) as never);
    const inFlight = f.service.pay(agent, { intentId: id });
    const second = new PaymentService(f.path, { policy: f.policy, wallet: f.wallet });
    try { expect((await second.pay(agent, { intentId: id })).status).toBe("unknown"); }
    finally { second.close(); }
    const payment = f.policy.authorize.mock.calls[0]![0];
    release({ decision: "allow", paymentDigest: paymentDigest(payment), authorization: "test" });
    expect((await inFlight).status).toBe("settled");
    expect((await f.reopen().pay(agent, { intentId: id })).status).toBe("settled");
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("reserves budget atomically for concurrent different payments", async () => {
    const f = fixture(); f.service.setPolicy(owner, { ...rules, totalBudget: "150" });
    const a = f.create(), b = f.create({ reference: "PAY-2" });
    const results = await Promise.all([f.service.pay(agent, { intentId: a }), f.service.pay(agent, { intentId: b })]);
    expect(results.map(r => r.code)).toEqual(["OK", "OVER_BUDGET"]);
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("does not submit after external policy denial, unavailability or a mismatched permit", async () => {
    for (const reply of [{ decision: "block", code: "POLICY_DENIED" }, { broken: true },
      { decision: "allow", paymentDigest: "b".repeat(64), authorization: "wrong" }]) {
      const f = fixture(), id = f.create();
      f.policy.authorize.mockResolvedValueOnce(reply as never);
      expect((await f.service.pay(agent, { intentId: id })).status).toBe("blocked");
      expect(f.wallet.submit).not.toHaveBeenCalled();
      expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "0.00" });
    }
  });

  it("rechecks revocation after awaiting external policy", async () => {
    const f = fixture(), id = f.create();
    f.policy.authorize.mockImplementationOnce(async (_payment, digest) => {
      f.service.setPolicy(owner, { ...rules, enabled: false });
      return { decision: "allow", paymentDigest: digest, authorization: "test" };
    });
    expect((await f.service.pay(agent, { intentId: id })).code).toBe("KILL_SWITCH_ON");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("schedules without moving funds and rechecks policy when due", async () => {
    const f = fixture(), id = f.create({ executeAt: "2026-11-13T01:00:00Z" });
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("scheduled");
    expect(f.wallet.submit).not.toHaveBeenCalled();
    f.service.setPolicy(owner, { ...rules, enabled: false }); f.advance(3600000);
    expect((await f.service.executeDue(agent))[0]!.code).toBe("KILL_SWITCH_ON");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("executes a due schedule exactly once and rejects expired intent", async () => {
    const f = fixture(), id = f.create({ executeAt: "2026-11-13T01:00:00Z" });
    await f.service.pay(agent, { intentId: id }); f.advance(3600000);
    expect((await f.service.executeDue(agent))[0]!.status).toBe("settled");
    expect(await f.service.executeDue(agent)).toEqual([]);
    const expired = f.create({ reference: "EXPIRED", expiresAt: "2026-11-13T01:00:01Z" });
    f.advance(2000);
    expect((await f.service.pay(agent, { intentId: expired })).code).toBe("INTENT_EXPIRED");
  });

  it("retains uncertain reservations across restarts and reconciles without resubmitting", async () => {
    const f = fixture(), id = f.create(); f.wallet.submit.mockRejectedValueOnce(new Error("transport timeout"));
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("unknown");
    f.advance(86400000);
    const reopened = f.reopen();
    expect(reopened.budget(owner)).toEqual({ spent: "0.00", reserved: "100.00" });
    expect((await reopened.pay(agent, { intentId: id })).status).toBe("unknown");
    expect((await reopened.reconcile(agent, id)).status).toBe("settled");
    expect((await reopened.reconcile(agent, id)).status).toBe("settled");
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
    expect(reopened.budget(owner)).toEqual({ spent: "100.00", reserved: "0.00" });
  });

  it("releases a verified rejection exactly once without resubmitting", async () => {
    const f = fixture(), id = f.create();
    f.wallet.submit.mockRejectedValueOnce(new Error("uncertain broadcast"));
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("unknown");
    f.wallet.lookup.mockImplementationOnce(async (_payment, digest) => ({ status: "rejected",
      paymentDigest: digest, txHash, validated: true, ledgerIndex: 101, ledgerResult: "tecPATH_DRY" }));
    expect((await f.service.reconcile(agent, id)).code).toBe("LEDGER_REJECTED");
    expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "0.00" });
    expect((await f.service.reconcile(agent, id)).status).toBe("rejected");
    expect((await f.service.pay(agent, { intentId: id })).status).toBe("rejected");
    expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "0.00" });
    expect(f.wallet.lookup).toHaveBeenCalledTimes(1);
    expect(f.wallet.submit).toHaveBeenCalledTimes(1);
  });

  it("does not treat submit responses or malformed validation evidence as settlement", async () => {
    for (const reply of [{ status: "submitted", txHash }, { status: "settled", validated: false, txHash },
      { ...settled("b".repeat(64)) }]) {
      const f = fixture(), id = f.create();
      f.wallet.submit.mockImplementationOnce(async (_payment, permit) => ({ paymentDigest: permit.paymentDigest, ...reply }) as never);
      expect((await f.service.pay(agent, { intentId: id })).status).not.toBe("settled");
      expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "100.00" });
    }
  });

  it("fails closed if durable audit writing is unavailable", async () => {
    const f = fixture(), id = f.create(); const db = new DatabaseSync(f.path);
    db.exec("DROP TABLE audit"); db.close();
    await expect(f.service.pay(agent, { intentId: id })).rejects.toThrow();
    expect(f.wallet.submit).not.toHaveBeenCalled();
    expect(f.service.budget(owner)).toEqual({ spent: "0.00", reserved: "0.00" });
  });

  it("blocks execution if stored audit history fails verification", async () => {
    const f = fixture(), id = f.create(), db = new DatabaseSync(f.path);
    const row = db.prepare("SELECT body FROM audit WHERE owner=? AND seq=1").get(owner.ownerId)!;
    const value = JSON.parse(row.body as string); value.event = "changed";
    db.prepare("UPDATE audit SET body=? WHERE owner=? AND seq=1").run(JSON.stringify(value), owner.ownerId);
    db.close();
    await expect(f.service.pay(agent, { intentId: id })).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(f.wallet.submit).not.toHaveBeenCalled();
  });

  it("HTTP authentication fixes the scope and refuses agent owner-operation requests", async () => {
    const f = fixture(), id = f.create();
    const token = randomBytes(32).toString("hex");
    const server = createTransferServer(f.service, new Map([[token, agent]]));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("no listener");
      const base = `http://127.0.0.1:${address.port}`;
      expect((await fetch(base + "/transfers/" + id)).status).toBe(401);
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      expect((await fetch(base + "/transfers/intents", { method: "POST", headers, body: JSON.stringify(f.input()) })).status).toBe(403);
      expect((await fetch(base + "/transfers/policy", { method: "PUT", headers,
        body: JSON.stringify({ ...rules, enabled: false }) })).status).toBe(403);
      const response = await fetch(base + "/transfers/pay", { method: "POST", headers, body: JSON.stringify({ intentId: id }) });
      expect((await response.json()).status).toBe("settled");
      expect((await fetch(base + "/transfers/audit", { headers })).status).toBe(403);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
