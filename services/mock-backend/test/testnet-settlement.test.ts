import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, hashes, Wallet, type SubmittableTransaction } from "xrpl";
import { CosignResponse, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS, type CosignRequest } from "@shucamoxa/shared";
import { createPolicyServer, HttpRulesReader } from "../../policy/src/index";
import type { PolicyClientLike, XrplClientLike } from "../../payment/src/types";
import { startMockBackend } from "../src/index";
import { testnetSettler } from "../src/testnet-settler";

const AGENT_TOKEN = "test-agent-token-not-a-secret-000001";
const OWNER_TOKEN = "test-owner-token-not-a-secret-000002";
const POLICY_READ_TOKEN = "test-policy-read-token-not-secret-03";
const CALLER_TOKEN = "test-policy-caller-token-not-secret4";

const paymentSigner = Wallet.generate();
const policySigner = Wallet.generate();
const treasury = Wallet.generate().address;
const karoo = Wallet.generate().address;
const zambezi = Wallet.generate().address;

/** Ledger stand-in: echoes the submitted Payment as validated tesSUCCESS and remembers every blob. */
class FakeLedger implements XrplClientLike {
  blobs: string[] = [];
  async autofill<T extends SubmittableTransaction>(tx: T): Promise<T> {
    return { ...tx, Sequence: 7, Fee: "36", LastLedgerSequence: 120 };
  }
  async getLedgerIndex() {
    return 100;
  }
  async submitAndWait(blob: string) {
    this.blobs.push(blob);
    const tx = decode(blob) as { Amount: { value: string } };
    const delivered = { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, value: tx.Amount.value };
    return { result: { hash: hashes.hashSignedTx(blob), validated: true, ledger_index: 101, engine_result: "tesSUCCESS", meta: { TransactionResult: "tesSUCCESS", delivered_amount: delivered } } };
  }
  async request() {
    return { result: {} };
  }
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function start(rulesToken = POLICY_READ_TOKEN) {
  const ledger = new FakeLedger();
  let backendUrl = "";
  // The real policy service, reading the owner's live rules from the backend on every cosign.
  const policy = createPolicyServer({
    env: { POLICY_SEED: policySigner.seed!, POLICY_CALLER_TOKEN: CALLER_TOKEN, AGENT_ACCOUNT: paymentSigner.address, TREASURY_ACCOUNT: treasury, XRPL_WSS: XRPL_TESTNET_WSS },
    rulesReader: { getRules: () => new HttpRulesReader(`${backendUrl}/policy/rules`, rulesToken).getRules() },
    logger: () => {},
  });
  const policyClient: PolicyClientLike = {
    async cosign(request: CosignRequest) {
      const response = await policy.app.fetch(new Request("http://policy.test/cosign", {
        method: "POST", headers: { Authorization: `Bearer ${CALLER_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(request),
      }));
      return CosignResponse.parse(await response.json());
    },
  };
  const server = await startMockBackend({
    env: {
      SHUCAMOXA_MOCK: "1", MOCK_AGENT_TOKEN: AGENT_TOKEN, MOCK_OWNER_TOKEN: OWNER_TOKEN, MOCK_POLICY_TOKEN: POLICY_READ_TOKEN,
      SETTLEMENT_MODE: "xrpl-testnet", PAYMENT_SIGNER_SEED: paymentSigner.seed!, TREASURY_ACCOUNT: treasury, POLICY_ACCOUNT: policySigner.address,
      XRPL_WSS: XRPL_TESTNET_WSS, POLICY_URL: "http://127.0.0.1:8791", POLICY_CALLER_TOKEN: CALLER_TOKEN,
      SUPPLIER_ADDRESSES: `sup_karoo=${karoo},sup_zambezi=${zambezi}`,
    },
    port: 0,
    approvalsFile: join(mkdtempSync(join(tmpdir(), "testnet-")), "approvals.jsonl"),
    settler: testnetSettler({
      paymentSignerSeed: paymentSigner.seed!, treasuryAccount: treasury, policyAccount: policySigner.address,
      xrplWss: XRPL_TESTNET_WSS, policyUrl: "http://unused.test", policyCallerToken: CALLER_TOKEN, xrplClient: ledger, policyClient,
    }),
  });
  backendUrl = server.url;
  close = server.close;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await fetch(server.url + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
  };
  return { ledger, call };
}

const pay = (invoiceNumber: string, amount: string, supplierId = "sup_karoo") => ({ invoiceNumber, amount, supplierId, reason: "Approved supplier, within limits" });

describe("SETTLEMENT_MODE=xrpl-testnet through the real policy service", () => {
  it("settles a valid invoice only with both the payment signer's and the policy signer's signatures", async () => {
    const { ledger, call } = await start();
    const res = await call("POST", "/payments", AGENT_TOKEN, pay("INV-1042", "30.00"));
    expect(res.json).toMatchObject({ status: "settled", ruleCode: "OK" });
    expect(ledger.blobs).toHaveLength(1);
    const tx = decode(ledger.blobs[0]!) as any;
    expect(tx).toMatchObject({ TransactionType: "Payment", Account: treasury, Destination: karoo, Amount: { value: "30", issuer: RLUSD_TESTNET_ISSUER } });
    expect(tx.Signers.map((s: any) => s.Signer.Account).sort()).toEqual([paymentSigner.address, policySigner.address].sort());
    expect(res.json.txHash).toBe(hashes.hashSignedTx(ledger.blobs[0]!));
    const log = (await call("GET", "/log", AGENT_TOKEN)).json;
    expect(log.map((e: any) => e.event)).toEqual(["payment_settled", "payment_requested"]);
    expect(log[0]).toMatchObject({ ledgerResult: "tesSUCCESS", txHash: res.json.txHash });
    expect((await call("GET", "/rules", AGENT_TOKEN)).json).toMatchObject({ spent: "30.00", reserved: "0.00" });
  });

  it("the policy service refuses to co-sign when it cannot read the owner's rules, so nothing reaches the ledger", async () => {
    const { ledger, call } = await start("wrong-policy-read-token-0000000000000");
    const res = await call("POST", "/payments", AGENT_TOKEN, pay("INV-1043", "30.00"));
    expect(res.json).toMatchObject({ status: "blocked" });
    expect(ledger.blobs).toHaveLength(0);
    expect((await call("GET", "/rules", AGENT_TOKEN)).json.spent).toBe("0.00");
  });

  it("serves supplier addresses only to the policy token", async () => {
    const { call } = await start();
    expect((await call("GET", "/policy/rules", AGENT_TOKEN)).status).toBe(403);
    expect((await call("GET", "/policy/rules", OWNER_TOKEN)).status).toBe(403);
    const rules = await call("GET", "/policy/rules", POLICY_READ_TOKEN);
    expect(rules.status).toBe(200);
    expect(rules.json.suppliers).toContainEqual({ id: "sup_karoo", name: "Karoo Textiles", address: karoo, status: "approved" });
    expect(JSON.stringify((await call("GET", "/rules", AGENT_TOKEN)).json)).not.toContain(karoo);
  });
});
