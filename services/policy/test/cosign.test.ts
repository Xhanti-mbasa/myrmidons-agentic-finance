import { describe, expect, it } from "vitest";
import {
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  toHex,
  XRPL_TESTNET_WSS,
  type CosignRequest,
  type Rules,
} from "@shucamoxa/shared";
import { encode, encodeForMultisigning } from "ripple-binary-codec";
import { deriveAddress, verify as verifyKeypairSignature } from "ripple-keypairs";
import { decode, multisign, Wallet } from "xrpl";
import { createPolicyServer, type PolicyLogEntry } from "../src/server";

const CALLER_TOKEN = "policy-caller-secret-token-1234567890";
const AGENT_BACKEND_TOKEN = "agent-backend-different-token-0987654321";

const VALID_RULES: Rules = {
  perPaymentCap: "50.00",
  totalBudget: "1000.00",
  spent: "0.00",
  reserved: "0.00",
  remaining: "1000.00",
  periodStart: "2026-11-01",
  killSwitch: false,
  suppliers: [{ id: "sup_karoo", name: "Karoo Textiles" }],
};

function setupTest() {
  const treasury = Wallet.generate();
  const agent = Wallet.generate();
  const policy = Wallet.generate();
  const supplier = Wallet.generate();

  const env = {
    POLICY_SEED: policy.seed!,
    POLICY_CALLER_TOKEN: CALLER_TOKEN,
    AGENT_ACCOUNT: agent.classicAddress,
    TREASURY_ACCOUNT: treasury.classicAddress,
    XRPL_WSS: XRPL_TESTNET_WSS,
  };

  const logs: PolicyLogEntry[] = [];
  let currentRules: any = {
    ...VALID_RULES,
    suppliers: [
      {
        id: "sup_karoo",
        name: "Karoo Textiles",
        address: supplier.classicAddress,
        status: "approved",
      },
    ],
  };
  let rulesReaderOverride: (() => Promise<Rules> | Rules) | null = null;

  const { app } = createPolicyServer({
    env,
    rulesReader: () => {
      if (rulesReaderOverride) return rulesReaderOverride();
      return currentRules;
    },
    logger: (entry) => logs.push(entry),
  });

  const postCosign = (
    body: unknown,
    headers: Record<string, string> = { Authorization: `Bearer ${CALLER_TOKEN}` }
  ) =>
    app.request("/cosign", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const makePaymentTx = (overrides: Record<string, unknown> = {}) => ({
    TransactionType: "Payment",
    Account: treasury.classicAddress,
    Destination: supplier.classicAddress,
    Amount: {
      currency: RLUSD_CURRENCY_HEX,
      issuer: RLUSD_TESTNET_ISSUER,
      value: "30",
    },
    Fee: "20",
    Sequence: 1,
    SigningPubKey: "",
    Flags: 0x80000000,
    Memos: [
      {
        Memo: {
          MemoType: toHex(MEMO_TYPE),
          MemoData: "a".repeat(64),
        },
      },
    ],
    ...overrides,
  });

  const makeValidCosignRequest = (txOverrides: Record<string, unknown> = {}) => {
    const tx = makePaymentTx(txOverrides);
    const signed = agent.sign(tx as any, true);
    const decoded = decode(signed.tx_blob);
    const { Signers: _signers, ...txJson } = decoded;

    const request: CosignRequest = {
      txJson,
      agentSignedBlob: signed.tx_blob,
      request: {
        supplierId: "sup_karoo",
        amount: "30.00",
        invoiceNumber: "INV-1001",
        logEntryHash: "a".repeat(64),
      },
    };

    return { tx, signed, txJson, request };
  };

  return {
    treasury,
    agent,
    policy,
    supplier,
    env,
    logs,
    postCosign,
    makePaymentTx,
    makeValidCosignRequest,
    setRules: (r: Rules) => {
      currentRules = r;
    },
    setRulesReaderOverride: (fn: () => Promise<Rules> | Rules) => {
      rulesReaderOverride = fn;
    },
  };
}

describe("Policy Service: cosign endpoint", () => {
  it("1. Valid agent multisign blob -> allow; xrpl.multisign([agentBlob, policyBlob]) produces a tx with two Signers that both verify", async () => {
    const { postCosign, makeValidCosignRequest, agent, policy } = setupTest();
    const { request, signed } = makeValidCosignRequest();

    const res = await postCosign(request);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.decision).toBe("allow");
    expect(body.ruleCode).toBe("OK");
    expect(typeof body.policySignedBlob).toBe("string");

    // Multisign both blobs
    const combinedBlob = multisign([signed.tx_blob, body.policySignedBlob]);
    expect(combinedBlob).toBeDefined();

    const combinedTx = decode(combinedBlob) as any;
    expect(Array.isArray(combinedTx.Signers)).toBe(true);
    expect(combinedTx.Signers).toHaveLength(2);

    // Verify agent's signer
    const agentSignerEntry = combinedTx.Signers.find((s: any) => s.Signer.Account === agent.classicAddress);
    expect(agentSignerEntry).toBeDefined();
    const agentSigner = agentSignerEntry.Signer;
    expect(deriveAddress(agentSigner.SigningPubKey)).toBe(agent.classicAddress);
    const agentMessage = encodeForMultisigning(combinedTx, agent.classicAddress);
    expect(verifyKeypairSignature(agentMessage, agentSigner.TxnSignature, agentSigner.SigningPubKey)).toBe(true);

    // Verify policy's signer
    const policySignerEntry = combinedTx.Signers.find((s: any) => s.Signer.Account === policy.classicAddress);
    expect(policySignerEntry).toBeDefined();
    const policySigner = policySignerEntry.Signer;
    expect(deriveAddress(policySigner.SigningPubKey)).toBe(policy.classicAddress);
    const policyMessage = encodeForMultisigning(combinedTx, policy.classicAddress);
    expect(verifyKeypairSignature(policyMessage, policySigner.TxnSignature, policySigner.SigningPubKey)).toBe(true);
  });

  describe("2. Auth: missing token, wrong token, or agent's token -> 401. Body > 64 KB -> 413", () => {
    it.each([
      ["no token", {}],
      ["wrong token", { Authorization: "Bearer wrong-token-1234567890" }],
      ["agent's token", { Authorization: `Bearer ${AGENT_BACKEND_TOKEN}` }],
      ["token without Bearer scheme", { Authorization: CALLER_TOKEN }],
    ])("401 on %s", async (_label, headers) => {
      const { postCosign, makeValidCosignRequest } = setupTest();
      const { request } = makeValidCosignRequest();

      const res = await postCosign(request, headers);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: "unauthorized", message: "A valid bearer token is required." });
    });

    it("413 for a body over 64 KB", async () => {
      const { postCosign, makeValidCosignRequest } = setupTest();
      const { request } = makeValidCosignRequest();

      const largeBody = JSON.stringify({
        ...request,
        padding: "x".repeat(65 * 1024),
      });

      const res = await postCosign(largeBody);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json).toEqual({ error: "payload_too_large", message: "The request body is over 64 KB." });
    });
  });

  describe("3. Blocked with FORBIDDEN_TX_FIELDS", () => {
    it("blocks blob signed by non-agent key", async () => {
      const { postCosign, makePaymentTx, makeValidCosignRequest } = setupTest();
      const { request } = makeValidCosignRequest();

      const otherWallet = Wallet.generate();
      const otherSigned = otherWallet.sign(makePaymentTx() as any, true);

      const res = await postCosign({
        ...request,
        agentSignedBlob: otherSigned.tx_blob,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        decision: "block",
        ruleCode: "FORBIDDEN_TX_FIELDS",
        reason: "Blocked: the transaction used fields the policy does not allow.",
      });
    });

    it("blocks blob with two Signers", async () => {
      const { postCosign, makePaymentTx, makeValidCosignRequest, agent } = setupTest();
      const { request } = makeValidCosignRequest();

      const tx = makePaymentTx();
      const agentSigned = agent.sign(tx as any, true);
      const otherWallet = Wallet.generate();
      const otherSigned = otherWallet.sign(tx as any, true);

      const combinedTwoSignersBlob = multisign([agentSigned.tx_blob, otherSigned.tx_blob]);

      const res = await postCosign({
        ...request,
        agentSignedBlob: combinedTwoSignersBlob,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks blob with no Signers", async () => {
      const { postCosign, makePaymentTx, makeValidCosignRequest, agent } = setupTest();
      const { request } = makeValidCosignRequest();

      const tx = makePaymentTx({ SigningPubKey: agent.publicKey });
      const singleSigned = agent.sign(tx as any); // single sign has no Signers array

      const res = await postCosign({
        ...request,
        agentSignedBlob: singleSigned.tx_blob,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks txJson whose Amount differs from decoded blob", async () => {
      const { postCosign, makeValidCosignRequest } = setupTest();
      const { request, txJson } = makeValidCosignRequest();

      const mismatchedTxJson = {
        ...txJson,
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "999",
        },
      };

      const res = await postCosign({
        ...request,
        txJson: mismatchedTxJson,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks txJson whose Destination differs from decoded blob", async () => {
      const { postCosign, makeValidCosignRequest } = setupTest();
      const { request, txJson } = makeValidCosignRequest();

      const mismatchedTxJson = {
        ...txJson,
        Destination: Wallet.generate().classicAddress,
      };

      const res = await postCosign({
        ...request,
        txJson: mismatchedTxJson,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks tx SigningPubKey not ''", async () => {
      const { postCosign, makeValidCosignRequest, agent } = setupTest();
      const { request } = makeValidCosignRequest();

      const decoded = decode(request.agentSignedBlob) as any;
      decoded.SigningPubKey = agent.publicKey;
      const reEncodedBlob = encode(decoded);

      const res = await postCosign({
        ...request,
        agentSignedBlob: reEncodedBlob,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks TransactionType TrustSet", async () => {
      const { postCosign, treasury, agent } = setupTest();

      const trustSetTx = {
        TransactionType: "TrustSet",
        Account: treasury.classicAddress,
        LimitAmount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "1000",
        },
        Fee: "20",
        Sequence: 1,
        SigningPubKey: "",
      };

      const signed = agent.sign(trustSetTx as any, true);
      const decoded = decode(signed.tx_blob);
      const { Signers: _signers, ...txJson } = decoded;

      const res = await postCosign({
        txJson,
        agentSignedBlob: signed.tx_blob,
        request: {
          supplierId: "sup_karoo",
          amount: "30.00",
          invoiceNumber: "INV-1001",
          logEntryHash: "a".repeat(64),
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("blocks Account not treasury", async () => {
      const { postCosign, agent, supplier } = setupTest();

      const nonTreasuryTx = {
        TransactionType: "Payment",
        Account: agent.classicAddress, // not treasury
        Destination: supplier.classicAddress,
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "30",
        },
        Fee: "20",
        Sequence: 1,
        SigningPubKey: "",
      };

      const signed = agent.sign(nonTreasuryTx as any, true);
      const decoded = decode(signed.tx_blob);
      const { Signers: _signers, ...txJson } = decoded;

      const res = await postCosign({
        txJson,
        agentSignedBlob: signed.tx_blob,
        request: {
          supplierId: "sup_karoo",
          amount: "30.00",
          invoiceNumber: "INV-1001",
          logEntryHash: "a".repeat(64),
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.decision).toBe("block");
      expect(body.ruleCode).toBe("FORBIDDEN_TX_FIELDS");
    });
  });

  it("4. killSwitch: true -> KILL_SWITCH_ON", async () => {
    const { postCosign, makeValidCosignRequest, setRules } = setupTest();
    setRules({ ...VALID_RULES, killSwitch: true });

    const { request } = makeValidCosignRequest();
    const res = await postCosign(request);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      decision: "block",
      ruleCode: "KILL_SWITCH_ON",
      reason: "Blocked: the owner has revoked the agent's payment authority.",
    });
  });

  it("5. RulesReader throws -> block, reason 'policy check failed', no stack trace, no signature", async () => {
    const { postCosign, makeValidCosignRequest, setRulesReaderOverride } = setupTest();
    setRulesReaderOverride(() => {
      throw new Error("sensitive database timeout\n  at SecretConnection.connect (/db/secret.ts:12:34)");
    });

    const { request } = makeValidCosignRequest();
    const res = await postCosign(request);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({
      decision: "block",
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: "policy check failed",
    });
    expect(body.policySignedBlob).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("database timeout");
    expect(serialized).not.toContain("SecretConnection");
    expect(serialized).not.toContain("stack");
  });

  describe("6. createPolicyServer refuses: XRPL_WSS not on testnet allowlist; POLICY_SEED whose address equals AGENT_ACCOUNT", () => {
    it("refuses XRPL_WSS not on testnet allowlist", () => {
      const { env } = setupTest();
      expect(() =>
        createPolicyServer({
          env: { ...env, XRPL_WSS: "wss://s1.ripple.com" }, // mainnet
        })
      ).toThrow(/not on the testnet allowlist/i);
    });

    it("refuses POLICY_SEED whose address equals AGENT_ACCOUNT", () => {
      const { env, agent } = setupTest();
      expect(() =>
        createPolicyServer({
          env: {
            ...env,
            POLICY_SEED: agent.seed!,
            AGENT_ACCOUNT: agent.classicAddress,
          },
        })
      ).toThrow(/must not derive the AGENT_ACCOUNT/i);
    });
  });

  it("7. Logs never contain POLICY_SEED", async () => {
    const { postCosign, makeValidCosignRequest, logs, env, setRulesReaderOverride } = setupTest();

    // 1. Process valid request
    const { request } = makeValidCosignRequest();
    await postCosign(request);

    // 2. Process invalid auth
    await postCosign(request, { Authorization: "Bearer wrong-token" });

    // 3. Process failing rules reader
    setRulesReaderOverride(() => {
      throw new Error("DB error");
    });
    await postCosign(request);

    expect(logs.length).toBeGreaterThan(0);
    const allLogs = JSON.stringify(logs);
    expect(allLogs).not.toContain(env.POLICY_SEED);
  });

  it("GET /health returns { ok: true } without authentication", async () => {
    const { env } = setupTest();
    const { app } = createPolicyServer({ env });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
