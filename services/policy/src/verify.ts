import { canonicalJson, type RuleCode, ruleExplanation } from "@shucamoxa/shared";
import { encodeForMultisigning } from "ripple-binary-codec";
import { deriveAddress, verify as verifyKeypairSignature } from "ripple-keypairs";
import { decode } from "xrpl";

export type VerificationResult =
  | {
      ok: true;
      decodedTx: Record<string, unknown>;
      txToSign: Record<string, unknown>;
    }
  | {
      ok: false;
      ruleCode: RuleCode;
      reason: string;
    };

export function decodeAndVerifyAgentSignedBlob(
  agentSignedBlob: string,
  txJson: Record<string, unknown>,
  agentAccount: string
): VerificationResult {
  let decodedTx: Record<string, unknown>;
  try {
    decodedTx = decode(agentSignedBlob);
  } catch {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if (!decodedTx || typeof decodedTx !== "object") {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if (decodedTx.SigningPubKey !== "") {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if ("TxnSignature" in decodedTx && decodedTx.TxnSignature !== undefined) {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  const signers = decodedTx.Signers;
  if (!Array.isArray(signers) || signers.length !== 1) {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  const signerWrapper = signers[0] as Record<string, unknown> | undefined;
  const signer = signerWrapper?.Signer as Record<string, unknown> | undefined;
  if (!signer || typeof signer !== "object") {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if (signer.Account !== agentAccount) {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if (typeof signer.SigningPubKey !== "string" || typeof signer.TxnSignature !== "string") {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  let derivedSignerAccount: string;
  try {
    derivedSignerAccount = deriveAddress(signer.SigningPubKey);
  } catch {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  if (derivedSignerAccount !== agentAccount) {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  try {
    const messageHex = encodeForMultisigning(decodedTx, agentAccount);
    const valid = verifyKeypairSignature(messageHex, signer.TxnSignature, signer.SigningPubKey);
    if (!valid) {
      return {
        ok: false,
        ruleCode: "FORBIDDEN_TX_FIELDS",
        reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
      };
    }
  } catch {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  const { Signers: _decodedSigners, ...decodedWithoutSigners } = decodedTx;
  const { Signers: _txJsonSigners, ...txJsonWithoutSigners } = txJson;

  try {
    const canonicalDecoded = canonicalJson(decodedWithoutSigners);
    const canonicalTxJson = canonicalJson(txJsonWithoutSigners);
    if (canonicalDecoded !== canonicalTxJson) {
      return {
        ok: false,
        ruleCode: "FORBIDDEN_TX_FIELDS",
        reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
      };
    }
  } catch {
    return {
      ok: false,
      ruleCode: "FORBIDDEN_TX_FIELDS",
      reason: ruleExplanation("FORBIDDEN_TX_FIELDS"),
    };
  }

  return {
    ok: true,
    decodedTx,
    txToSign: decodedWithoutSigners,
  };
}
