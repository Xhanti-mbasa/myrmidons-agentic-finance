import { afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaymentService, type PaymentAdapters, type Principal } from "../services/payments/src/payment";
export const owner: Principal = { ownerId: "business", subjectId: "owner", role: "owner" };
export const agent: Principal = { ...owner, subjectId: "agent", role: "agent" };
export const source = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
export const destination = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";
export const rules = { enabled: true, perPaymentCap: "100", totalBudget: "150", recipientCaps: {} };
// Deliberately simulated receipts. These hashes are NOT ledger evidence.
export const receipt = (paymentDigest: string) => ({ status: "settled", paymentDigest,
  txHash: "A".repeat(64), validated: true, ledgerIndex: 100, ledgerResult: "tesSUCCESS" });
const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "shucamoxa-adversarial-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "payments.sqlite");
  const policy = { authorize: vi.fn<PaymentAdapters["policy"]["authorize"]>(async (_p, paymentDigest) =>
    ({ decision: "allow", paymentDigest, authorization: "simulated-permit" })) };
  const wallet = {
    submit: vi.fn<PaymentAdapters["wallet"]["submit"]>(async (_p, permit) => receipt(permit.paymentDigest)),
    lookup: vi.fn<PaymentAdapters["wallet"]["lookup"]>(async (_p, digest) => receipt(digest)),
  };
  let now = Date.parse("2026-11-13T00:00:00Z");
  const connect = () => { const s = new PaymentService(path, { policy, wallet }, () => new Date(now));
    cleanup.push(() => s.close()); return s; };
  const service = connect();
  service.registerAccount(owner, { id: "treasury", address: source });
  service.approveRecipient(owner, { id: "vendor", kind: "vendor", address: destination, destinationTag: 0 });
  service.setPolicy(owner, rules);
  const input = (extra = {}) => ({ sourceAccountId: "treasury", recipientId: "vendor", amount: "100",
    reference: "INV-1", executeAt: null, expiresAt: "2026-11-14T00:00:00Z", ...extra });
  return { service, policy, wallet, path, connect, input,
    create: (extra = {}) => service.createIntent(owner, input(extra)).intentId,
    advance: (ms: number) => { now += ms; } };
}
