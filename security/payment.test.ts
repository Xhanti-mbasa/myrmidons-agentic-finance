import { expect } from "vitest";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { attack } from "./harness";
import { agent, owner, fixture, rules, source, receipt } from "./fixture";
import { createTransferServer } from "../services/payments/src/http";
import { Amount, toCents, fromCents, TransferPermit } from "../packages/shared/src/index";
const target = "payment coordinator";
const evidence = "simulated test (real SQLite; simulated policy/wallet)";

attack("AUTH-01", "Direct calls with agent principal attempt every owner operation", target,
  "ASVS5 v8.2.1, v8.2.3; LLM06:2025", "BLOCKED", evidence, () => {
  const f = fixture();
  const calls = [() => f.service.createIntent(agent, f.input()), () => f.service.setPolicy(agent, rules),
    () => f.service.registerAccount(agent, { id: "evil", address: source }),
    () => f.service.approveRecipient(agent, { id: "evil", kind: "vendor", address: source }),
    () => f.service.unlock(agent, "agent"), () => f.service.audit(agent), () => f.service.budget(agent)];
  const denied = calls.filter(fn => { try { fn(); return false; } catch (e) { return (e as Error).message === "NOT_AUTHORIZED"; } });
  return { safe: denied.length === calls.length, observation: `${denied.length}/${calls.length} owner operations denied` };
});
attack("AUTH-02", "Cross-tenant UUID and forged pay fields", target,
  "ASVS5 v8.4.1, v8.2.2, v8.2.3", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  const other = { ...agent, ownerId: "other" };
  const denied = await f.service.pay(other, { intentId });
  await expect(f.service.pay(agent, { intentId, ownerId: "other", amount: "1", destination: source })).rejects.toThrow("INVALID_REQUEST");
  return { safe: denied.code === "NOT_AUTHORIZED" && f.wallet.submit.mock.calls.length === 0, observation: "Tenant and extra-field checks exercised without agent tools" };
});
attack("AUTH-03", "Loopback HTTP unauthenticated access and agent owner-action escalation", "payment HTTP",
  "ASVS5 v8.2.1, v8.3.1, v8.4.1", "BLOCKED", "live local (loopback HTTP + SQLite; simulated wallet)", async () => {
  const f = fixture(), intentId = f.create(), token = randomBytes(32).toString("hex");
  const server = createTransferServer(f.service, new Map([[token, agent]]));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No local listener");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const unauth = await fetch(base + `/transfers/${intentId}`);
    const escalate = await fetch(base + "/transfers/intents", { method: "POST", headers, body: JSON.stringify(f.input()) });
    const forged = await fetch(base + "/transfers/pay", { method: "POST", headers, body: JSON.stringify({ intentId, role: "owner" }) });
    return { safe: unauth.status === 401 && escalate.status === 403 && forged.status === 409 && !f.wallet.submit.mock.calls.length,
      observation: `HTTP status codes ${unauth.status}/${escalate.status}/${forged.status}; no submit` };
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
attack("PAY-01", "Parallel replay through two SQLite connections", target, "ASVS5 v2.3.1, v2.3.4", "BLOCKED", evidence, async () => {
  const f = fixture(), id = f.create(); let release!: () => void;
  f.policy.authorize.mockImplementationOnce(async (_p, digest) => {
    await new Promise<void>(r => { release = r; });
    return { decision: "allow", paymentDigest: digest, authorization: "simulated" };
  });
  const first = f.service.pay(agent, { intentId: id });
  const second = await f.connect().pay(agent, { intentId: id });
  release(); await first;
  const replay = await f.connect().pay(agent, { intentId: id });
  return { safe: second.status === "unknown" && replay.status === "settled" && f.wallet.submit.mock.calls.length === 1,
    observation: "Second connection and reopened connection cannot resubmit same intent" };
});
attack("PAY-02", "Concurrent distinct intents compete for insufficient budget", target, "ASVS5 v2.3.2, v2.3.3, v2.3.4", "BLOCKED", evidence, async () => {
  const f = fixture(), ids = [f.create(), f.create({ reference: "INV-2" })], second = f.connect();
  const results = await Promise.all([f.service.pay(agent, { intentId: ids[0] }), second.pay(agent, { intentId: ids[1] })]);
  return { safe: results.filter(r => r.code === "OVER_BUDGET").length === 1 && f.wallet.submit.mock.calls.length === 1 && f.service.budget(owner).spent === "100.00",
    observation: "One 100 payment admitted under 150 budget across separate DB connections" };
});
for (const [id, change, expected] of [
  ["PAY-03", { ...rules, enabled: false }, "KILL_SWITCH_ON"],
  ["PAY-04", { ...rules, perPaymentCap: "50" }, "POLICY_CHANGED"],
] as const) attack(id, `Policy change while permit is in flight: ${expected}`, target,
  "ASVS5 v2.3.1, v8.3.1; XRPL signing-boundary revocation (project requirement)", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  f.policy.authorize.mockImplementationOnce(async (_p, digest) => {
    f.service.setPolicy(owner, change); return { decision: "allow", paymentDigest: digest, authorization: "simulated" };
  });
  const result = await f.service.pay(agent, { intentId });
  return { safe: result.code === expected && !f.wallet.submit.mock.calls.length && f.service.budget(owner).reserved === "0.00",
    observation: "Rechecked policy immediately before wallet handoff" };
});
attack("PAY-05", "Recipient address/tag substitution after intent approval", target,
  "ASVS5 v8.2.3, v2.2.3; LLM06:2025", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  f.service.approveRecipient(owner, { id: "vendor", kind: "vendor", address: source, destinationTag: 1 });
  const result = await f.service.pay(agent, { intentId });
  return { safe: result.code === "INTENT_MISMATCH" && !f.wallet.submit.mock.calls.length, observation: "Stored recipient binding prevents directory replacement" };
});
attack("PAY-06", "Unknown submission, expiry and retry cannot free reservation", target,
  "ASVS5 v2.3.1, v2.3.3, v2.3.4; XRPL reliable transaction submission", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  f.wallet.submit.mockRejectedValueOnce(new Error("simulated connection loss"));
  const result = await f.service.pay(agent, { intentId }); f.advance(172800000);
  const next = f.connect(); await next.pay(agent, { intentId });
  f.wallet.lookup.mockImplementationOnce(async (_p, digest) => ({ status: "unknown", paymentDigest: digest }));
  await next.reconcile(agent, intentId);
  return { safe: result.status === "unknown" && next.budget(owner).reserved === "100.00" && f.wallet.submit.mock.calls.length === 1,
    observation: "Unknown reservation survives reconnection, expiry and inconclusive lookup" };
});
attack("PAY-07", "Reconcile a pending permit before submission; policy transport then fails", target,
  "ASVS5 v2.3.1, v2.3.3, v2.3.4", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create(); let reject!: (e: Error) => void;
  f.policy.authorize.mockImplementationOnce(() => new Promise((_r, j) => { reject = j; }));
  const pending = f.service.pay(agent, { intentId });
  // Attempt reconciliation before the wallet is allowed to submit.
  const reconciled = await f.service.reconcile(agent, intentId);
  expect(reconciled.status).toBe("unknown"); expect(f.wallet.submit.mock.calls.length).toBe(0);
  reject(new Error("simulated permit transport loss"));
  const final = await pending;
  return { safe: final.status === "blocked" && !f.wallet.lookup.mock.calls.length, observation: "Pre-submit reconciliation does not call lookup; failed permit releases only an unsubmitted reservation" };
});
attack("PAY-08", "Mismatched permit digest", target, "ASVS5 v2.2.3; CCSS9 1.05.8.1 Spend Verification", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  f.policy.authorize.mockResolvedValueOnce({ decision: "allow", paymentDigest: "b".repeat(64), authorization: "simulated" });
  const r = await f.service.pay(agent, { intentId });
  return { safe: r.code === "POLICY_DENIED" && !f.wallet.submit.mock.calls.length, observation: "Wrong prepared-payment digest rejected" };
});
attack("PAY-09", "Unvalidated or wrong-digest settlement receipt", target,
  "ASVS5 v2.2.3; XRPL validated metadata", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create();
  f.wallet.submit.mockResolvedValueOnce({ ...receipt("c".repeat(64)), validated: false });
  const r = await f.service.pay(agent, { intentId });
  return { safe: r.status === "unknown" && f.service.budget(owner).reserved === "100.00", observation: "Malformed validation evidence cannot release reservation" };
});
attack("PAY-10", "Forged syntactically valid authorization has no proof verification", "policy/wallet boundary",
  "ASVS5 v8.3.1; CCSS9 1.05.8.1 Spend Verification; P1", "NOT_IMPLEMENTED", "simulated test (contract acceptance only)", () => ({
    safe: !TransferPermit.safeParse({ decision: "allow", paymentDigest: "d".repeat(64), authorization: "forged-no-signature" }).success,
    observation: "Permit schema accepts arbitrary nonempty authorization; cryptographic verification delegated to absent wallet" }));
attack("MONEY-01", "Boundary, float, exponent, sign, whitespace and Unicode amounts", "shared money",
  "ASVS5 v2.2.1, v2.3.2", "BLOCKED", "simulated test", () => {
  const bad: unknown[] = [0.1, 1, "0", "0.00", "-1", "+1", "1e2", "01", " 1", "1 ", "1.001", "1000000000000", "١", "１", "NaN", "Infinity"];
  return { safe: bad.every(x => !Amount.safeParse(x).success) && toCents("999999999999.99") === 99999999999999n && fromCents(toCents("0.01")) === "0.01",
    observation: "16 malformed forms rejected; min and max exact integer cents" };
});
attack("MONEY-02", "Equivalent decimals cannot create a second invoice intent", target,
  "ASVS5 v2.3.1, v2.3.4", "BLOCKED", evidence, () => {
  const f = fixture(), id = f.create({ amount: "100" });
  return { safe: ["100.0", "100.00"].every(amount => f.create({ amount }) === id), observation: "Same owner/reference and economic amount deduplicate" };
});
attack("MONEY-03", "Cap exact boundary versus one cent above", target,
  "ASVS5 v2.3.2", "BLOCKED", evidence, async () => {
  const f = fixture(), good = f.create(), bad = f.create({ amount: "100.01", reference: "INV-2" });
  const results = await Promise.all([f.service.pay(agent, { intentId: good }), f.service.pay(agent, { intentId: bad })]);
  return { safe: results[0]?.status === "settled" && results[1]?.code === "OVER_PER_PAYMENT_CAP", observation: "100.00 admitted; 100.01 denied by cap" };
});
attack("PAY-11", "Reject policy denial and unavailable policy without wallet submission", target,
  "ASVS5 v8.3.1, v2.3.3", "BLOCKED", evidence, async () => {
  const outcomes = [];
  for (const unavailable of [false, true]) {
    const f = fixture(), intentId = f.create();
    if (unavailable) f.policy.authorize.mockRejectedValueOnce(new Error("synthetic failure"));
    else f.policy.authorize.mockResolvedValueOnce({ decision: "block", code: "POLICY_DENIED" });
    const r = await f.service.pay(agent, { intentId });
    outcomes.push(r.status === "blocked" && !f.wallet.submit.mock.calls.length && f.service.budget(owner).reserved === "0.00");
  }
  return { safe: outcomes.every(Boolean), observation: "Both pre-submit policy failures stop wallet invocation and release unsubmitted reservation" };
});
attack("PAY-12", "Reservation held while wallet call hangs and kill switch changes", target,
  "ASVS5 v2.3.3, v2.3.4; XRPL reliable transaction submission", "BLOCKED", evidence, async () => {
  const f = fixture(), intentId = f.create(); let release!: () => void;
  const entered = new Promise<void>(resolve => {
    f.wallet.submit.mockImplementationOnce(async (_p, permit) => {
      resolve(); await new Promise<void>(r => { release = r; });
      return { status: "unknown", paymentDigest: permit.paymentDigest };
    });
  });
  const pending = f.service.pay(agent, { intentId }); await entered;
  f.service.setPolicy(owner, { ...rules, enabled: false });
  const during = f.service.budget(owner); release(); const result = await pending;
  return { safe: during.reserved === "100.00" && result.status === "unknown" && f.service.budget(owner).reserved === "100.00",
    observation: "Changing kill switch during wallet handoff does not release uncertain funds; actual prevention of signing remains XRPL-16 NOT_IMPLEMENTED" };
});
