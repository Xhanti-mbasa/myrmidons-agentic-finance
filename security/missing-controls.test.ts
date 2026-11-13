import { existsSync } from "node:fs";
import { attack } from "./harness";
import { source, destination } from "./fixture";
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, MEMO_TYPE, toHex } from "../packages/shared/src/index";
import { policyVector,unknownReservationVector,deliveredAmountVector } from './policy-probes';
/** Executable mutation probes against the real policy API and receipt verifier,
 * plus explicit missing-deployment specifications. Local keys and scripted ledger
 * metadata are not Testnet evidence or proof of deployed custody/isolation.
 */
function absentBoundary(gate='live-signer-configuration') {
  // Missing runtime evidence is distinct from an absent source directory. Newly added
  // production policy/receipt APIs below are exercised directly, never relabelled as missing.
  if(existsSync(`security/evidence/${gate}.json`))
    throw new Error('New live evidence requires independent verification and a real runtime probe');
  return false;
}
const base = { TransactionType: "Payment", Account: source, Destination: destination,
  Amount: { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, value: "1" },
  Fee: "12", Flags: 0, Sequence: 1, LastLedgerSequence: 100, DestinationTag: 0,
  SigningPubKey: "", Memos: [{ Memo: { MemoType: toHex(MEMO_TYPE), MemoData: "a".repeat(64) } }] };
const vectors: Array<[string, string, object, string]> = [
  ...["SignerListSet", "SetRegularKey", "AccountSet", "TrustSet", "OfferCreate"].map((TransactionType, i): [string,string,object,string] =>
    [`XRPL-0${i + 1}`, `Reject ${TransactionType} at co-signer`, { ...base, TransactionType }, "XRPL transaction types; CCSS9 1.05.8.1 Spend Verification"]),
  ["XRPL-06", "Reject tfPartialPayment", { ...base, Flags: 0x00020000 }, "XRPL partial payments"],
  ["XRPL-07", "Reject Paths and SendMax DEX routing", { ...base, Paths: [[{ currency: "USD" }]], SendMax: "1000000" }, "XRPL Payment Paths/SendMax"],
  ["XRPL-08", "Reject excessive XRP Fee", { ...base, Fee: "1000000000" }, "XRPL transaction cost; ASVS5 v2.3.2"],
  ["XRPL-09", "Reject wrong RLUSD issuer", { ...base, Amount: { ...base.Amount, issuer: source } }, "XRPL issued currency amounts"],
  ["XRPL-10", "Reject wrong currency", { ...base, Amount: { ...base.Amount, currency: "USD" } }, "XRPL issued currency amounts"],
  ["XRPL-11", "Reject substituted DestinationTag", { ...base, DestinationTag: 1 }, "XRPL common transaction fields; P1"],
  ["XRPL-12", "Reject substituted audit Memo", { ...base, Memos: [{ Memo: { MemoType: toHex(MEMO_TYPE), MemoData: "b".repeat(64) } }] }, "XRPL common transaction fields; P1"],
  ["XRPL-13", "Reject stale LastLedgerSequence", { ...base, LastLedgerSequence: 1 }, "XRPL reliable transaction submission; P1"],
  ["XRPL-14", "Compare policy JSON with decoded signing bytes", { policyJSON: base, transactionToEncodeAndSign: { ...base, Destination: source } }, "XRPL binary format / multi-signing; P1"],
  ["XRPL-15", "Reject direct wallet call without permit and replayed permit", { prepared: base, authorization: "absent-or-used" }, "ASVS5 v8.3.1, v2.3.1; CCSS9 1.05.8.1 Spend Verification"],
  ["XRPL-16", "Recheck kill switch after handoff and before signing", { prepared: base, enabledAtSigning: false }, "ASVS5 v8.3.1; CCSS9 1.05.8.1 Spend Verification"],
  ["XRPL-17", "Retain reservation when signing result is unknown", { prepared: base, signedBlobMayExist: true, transportOutcome: "unknown" }, "ASVS5 v2.3.3; XRPL reliable transaction submission"],
  ["XRPL-18", "Require validated delivered_amount equal to authorized RLUSD", { tx: base, meta: { TransactionResult: "tesSUCCESS", delivered_amount: { ...base.Amount, value: "0.001" } } }, "XRPL partial payments / validated metadata"],
  ["XRPL-19", "Ledger enforces required signer quorum", { expectedEngineResult: "tefBAD_QUORUM", wallets: "fresh Testnet runtime wallets required" }, "XRPL multi-signing; CCSS9 1.02.1.1 Signing Configuration"],
  ["XRPL-20", "Ledger rejects disabled master and absent regular key bypass", { expectedEngineResult: "tefMASTER_DISABLED", wallets: "fresh Testnet runtime wallets required" }, "XRPL disable master key; CCSS9 1.02.1.1 Signing Configuration"],
];
for (const [id, title, vector, standard] of vectors) attack(id, title, "policy/receipt boundary; deployment gates separate", standard,
  Number(id.slice(5))>=19 ? 'NOT_IMPLEMENTED' : ['XRPL-01','XRPL-02','XRPL-03','XRPL-04','XRPL-05','XRPL-06','XRPL-07','XRPL-08','XRPL-09','XRPL-10','XRPL-11','XRPL-12','XRPL-14','XRPL-16','XRPL-17','XRPL-18'].includes(id)?'BLOCKED':'VULNERABLE',
  'real local policy signatures/production verification; scripted ledger metadata; no live funds', async () => {
    // Preserve concrete mutations and expected conditions for the implementation team; no network.
    if (Object.keys(vector).length === 0) throw new Error("Missing attack vector");
    if(Number(id.slice(5))<=16)return policyVector(id,vector);
    if(id==='XRPL-17')return unknownReservationVector();
    if(id==='XRPL-18')return deliveredAmountVector();
    return { safe: absentBoundary(), observation: "NOT_IMPLEMENTED: no production co-signer/wallet to receive this vector; no signing, submission or Testnet evidence" };
  });
attack("INTAKE-01", "Untrusted invoice intake cannot mint its own authorized intent", "invoice intake → deterministic coordinator",
  "LLM06:2025; ASVS5 v8.3.1; P2", "NOT_IMPLEMENTED", "source inspection", () => ({
    safe: absentBoundary('live-invoice-intake'), observation: "NOT_IMPLEMENTED: agent /payments and MCP /v1 invoice API are not implemented by the /transfers coordinator; no production least-privilege bridge" }));
attack("KEY-01", "Generate independent signing keys using reviewed entropy source", "wallet provisioning",
  "CCSS9 1.01.1.1, 1.01.2.1, 1.01.4.1", "NOT_IMPLEMENTED", "source inspection", () => ({
    safe: absentBoundary('live-key-provisioning'), observation: "NOT_IMPLEMENTED: generated test keys and imported operator seeds do not establish deployment provisioning, provenance or key independence" }));
attack("KEY-02", "Encrypted key storage and isolated multi-signer processes", "wallet/policy key custody",
  "CCSS9 1.03.1.1, 1.05.2.2, 1.05.9.1", "NOT_IMPLEMENTED", "source inspection", () => ({
    safe: absentBoundary('live-isolation'), observation: "NOT_IMPLEMENTED: private-file checks and service template exist; deployed encrypted key custody and process separation remain unverified" }));
attack("AUDIT-09", "Compare stored audit head with independently retrieved XRPL memo", "audit anchor verifier",
  "ASVS5 v16.4.2, v16.4.3; XRPL common transaction fields (Memos)", "NOT_IMPLEMENTED", "source inspection", () => ({
    safe: absentBoundary('live-audit-anchor'), observation: "NOT_IMPLEMENTED: memo encoding and receipt matching exist; no independently retained ledger-backed audit checkpoint reconciliation" }));
