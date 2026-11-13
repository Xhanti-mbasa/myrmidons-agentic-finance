import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createGuardedWalletAdapter, createSignedPolicyAdapter } from "../src/signing";
import { paymentDigest, type PreparedTransfer } from "../src/payment";
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS } from "../../../packages/shared/src/index";

const payment: PreparedTransfer = {
  intentId: "ad2ae810-0787-49f2-a458-1c57bff0fb11", ownerId: "business", sourceAccountId: "treasury",
  sourceAddress: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", recipientId: "vendor", recipientKind: "vendor",
  destination: RLUSD_TESTNET_ISSUER, amount: "1.00", reference: "PAY-1", network: XRPL_TESTNET_WSS,
  currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, policyVersion: 1,
  expiresAt: "2026-11-14T00:00:00Z", auditHash: "a".repeat(64),
};
function fixture() {
  const keys = generateKeyPairSync("ed25519"); let time = Date.parse("2026-11-13T00:00:00Z");
  const now = () => new Date(time), check = vi.fn(async () => {});
  const provider = { submit: vi.fn(async () => ({ status: "unknown" })), lookup: vi.fn(async () => ({})) };
  const policy = createSignedPolicyAdapter(keys.privateKey, check, now);
  const wallet = createGuardedWalletAdapter(keys.publicKey, check, provider, now);
  return { policy, wallet, check, provider, expire: () => { time += 86400000; } };
}
describe("independent signed authorization adapters", () => {
  it("verifies an exact signed payment and checks current authority at both boundaries", async () => {
    const f = fixture(), digest = paymentDigest(payment), permit = await f.policy.authorize(payment, digest) as any;
    await f.wallet.submit(payment, permit);
    expect(f.check).toHaveBeenCalledTimes(2); expect(f.provider.submit).toHaveBeenCalledTimes(1);
  });
  it.each(["sourceAddress", "destination", "amount", "issuer", "network", "reference", "auditHash", "expiresAt", "policyVersion"])("rejects changed %s", async field => {
    const f = fixture(), permit = await f.policy.authorize(payment, paymentDigest(payment)) as any;
    const changed = { ...payment, [field]: field === "policyVersion" ? 2 : "changed" };
    await expect(f.wallet.submit(changed as PreparedTransfer, { ...permit, paymentDigest: paymentDigest(changed as PreparedTransfer) })).rejects.toThrow("POLICY_DENIED");
    expect(f.provider.submit).not.toHaveBeenCalled();
  });
  it("rejects forged signatures, wrong signing keys and expiry", async () => {
    const f = fixture(), digest = paymentDigest(payment), permit = await f.policy.authorize(payment, digest) as any;
    const other = fixture(), forged = await other.policy.authorize(payment, digest) as any;
    await expect(f.wallet.submit(payment, forged)).rejects.toThrow("POLICY_DENIED");
    await expect(f.wallet.submit(payment, { paymentDigest: digest, authorization: "fake-test-permit" })).rejects.toThrow("POLICY_DENIED");
    f.expire(); await expect(f.wallet.submit(payment, permit)).rejects.toThrow("POLICY_DENIED");
    expect(f.provider.submit).not.toHaveBeenCalled();
  });
  it("blocks valid permits when current revocation or policy checks fail", async () => {
    const f = fixture(), permit = await f.policy.authorize(payment, paymentDigest(payment)) as any;
    f.check.mockRejectedValueOnce(new Error("KILL_SWITCH_ON"));
    await expect(f.wallet.submit(payment, permit)).rejects.toThrow("KILL_SWITCH_ON");
    expect(f.provider.submit).not.toHaveBeenCalled();
  });
});
