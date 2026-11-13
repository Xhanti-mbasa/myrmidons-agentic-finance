import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet, Client, decode, hashes } from "xrpl";
import { canonicalJson, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS } from "@shucamoxa/shared";
import type { PreparedTransfer } from "../../payments/src/payment";
import { XrplWalletAdapter } from "../src/wallet-adapter";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("wallet adapter", () => {
  it("records before submission, verifies the validated transaction and never submits twice", async () => {
    const sender = Wallet.generate(), recipient = Wallet.generate();
    const payment: PreparedTransfer = { intentId: "test-intent", ownerId: "owner", sourceAccountId: "sender", recipientId: "recipient", recipientKind: "vendor",
      sourceAddress: sender.address, destination: recipient.address, amount: "5.25", reference: "invoice", network: XRPL_TESTNET_WSS,
      currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, policyVersion: 1, auditHash: "a".repeat(64) };
    const digest = createHash("sha256").update(canonicalJson(payment)).digest("hex");
    let storedBlob = "";
    vi.spyOn(Client.prototype, "connect").mockResolvedValue();
    vi.spyOn(Client.prototype, "disconnect").mockResolvedValue();
    vi.spyOn(Client.prototype, "isConnected").mockReturnValue(true);
    vi.spyOn(Client.prototype, "getLedgerIndex").mockResolvedValue(100);
    vi.spyOn(Client.prototype, "request").mockImplementation(async (req: any): Promise<any> => {
      if (req.command === "account_info") return { result: { account_data: { Sequence: 1, Balance: "100000000", OwnerCount: 1 } } };
      if (req.command === "server_info") return { result: { info: { validated_ledger: { reserve_base_xrp: 1, reserve_inc_xrp: 0.2 } } } };
      if (req.command === "account_lines") return { result: { lines: [{ account: RLUSD_TESTNET_ISSUER, currency: RLUSD_CURRENCY_HEX, balance: req.account === sender.address ? "10" : "0", limit: "100" }] } };
      if (req.command === "tx") { const tx = decode(storedBlob); return { result: { validated: true, hash: hashes.hashSignedTx(storedBlob), ledger_index: 101,
        tx_json: tx, meta: { TransactionResult: "tesSUCCESS", delivered_amount: { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, value: "5.25" } } } }; }
      throw new Error("unexpected request");
    });
    const broadcast = vi.spyOn(Client.prototype, "submit").mockImplementation(async (blob: any): Promise<any> => { storedBlob = blob; return {}; });
    const dir = mkdtempSync(join(tmpdir(), "xrpl-adapter-")); dirs.push(dir);
    const sign = vi.fn(async ({ transaction }: { transaction: any }) => sender.sign(transaction).tx_blob);
    const adapter = new XrplWalletAdapter(join(dir, "ops.sqlite"), { sign });
    try {
      const receipt = await adapter.submit(payment, { paymentDigest: digest, authorization: "test-only-permit" });
      expect(receipt.status).toBe("settled");
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect((await adapter.lookup(payment, digest)).status).toBe("settled");
      expect((await adapter.submit(payment, { paymentDigest: digest, authorization: "test-only-permit" })).status).toBe("unknown");
      expect(broadcast).toHaveBeenCalledTimes(1);
      const next = { ...payment, intentId: "another-intent" };
      const nextDigest = createHash("sha256").update(canonicalJson(next)).digest("hex");
      sign.mockRejectedValueOnce(new Error("signer unavailable"));
      expect((await adapter.submit(next, { paymentDigest: nextDigest, authorization: "test-only-permit" })).status).toBe("unknown");
      expect((await adapter.submit(next, { paymentDigest: nextDigest, authorization: "test-only-permit" })).status).toBe("unknown");
      expect(sign).toHaveBeenCalledTimes(2);
      expect(broadcast).toHaveBeenCalledTimes(1);
      const altered = { ...payment, intentId: "altered-intent" };
      const alteredDigest = createHash("sha256").update(canonicalJson(altered)).digest("hex");
      sign.mockImplementationOnce(async ({ transaction }) => sender.sign({ ...transaction, Destination: sender.address }).tx_blob);
      expect((await adapter.submit(altered, { paymentDigest: alteredDigest, authorization: "test-only-permit" })).status).toBe("unknown");
      expect(broadcast).toHaveBeenCalledTimes(1);
      const timeout = { ...payment, intentId: "timeout-intent" };
      const timeoutDigest = createHash("sha256").update(canonicalJson(timeout)).digest("hex");
      broadcast.mockImplementationOnce(async (blob: any): Promise<any> => { storedBlob = blob; throw new Error("connection lost"); });
      expect((await adapter.submit(timeout, { paymentDigest: timeoutDigest, authorization: "test-only-permit" })).status).toBe("unknown");
      const restarted = new XrplWalletAdapter(join(dir, "ops.sqlite"), { sign });
      try {
        expect((await restarted.lookup(timeout, timeoutDigest)).status).toBe("settled");
        expect((await restarted.submit(timeout, { paymentDigest: timeoutDigest, authorization: "test-only-permit" })).status).toBe("unknown");
        expect(broadcast).toHaveBeenCalledTimes(2);
      } finally { restarted.close(); }
    } finally { adapter.close(); }
  });
});
