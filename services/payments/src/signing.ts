import { sign, verify, type KeyObject } from "node:crypto";
import { SigningPermitClaims, canonicalJson } from "../../../packages/shared/src/index";
import { PaymentError, paymentDigest, type PaymentAdapters, type PreparedTransfer } from "./payment";

/** Must consult authoritative owner state and the durable reservation, never model/tool output.
 * The deployment must serialize revocation and actual signing under this boundary. */
export type SigningBoundary = (payment: PreparedTransfer) => Promise<void>;

const bytes = (claims: SigningPermitClaims) => Buffer.from(canonicalJson(claims));
function claimsFor(payment: PreparedTransfer): SigningPermitClaims {
  return SigningPermitClaims.parse({ version: 1, audience: "shucamoxa-testnet-wallet",
    paymentDigest: paymentDigest(payment), intentId: payment.intentId,
    policyVersion: payment.policyVersion, expiresAt: payment.expiresAt });
}
function ed25519(key: KeyObject, type: "private" | "public"): void {
  if (key.type !== type || key.asymmetricKeyType !== "ed25519") throw new Error("Expected Ed25519 " + type + " key");
}

/** Run in an isolated policy service. Inject keys from that service's secret store. */
export function createSignedPolicyAdapter(privateKey: KeyObject, check: SigningBoundary,
  now: () => Date = () => new Date()): PaymentAdapters["policy"] {
  ed25519(privateKey, "private");
  return { async authorize(payment, digest) {
    const claims = claimsFor(payment);
    if (digest !== claims.paymentDigest || Date.parse(claims.expiresAt) <= now().getTime())
      throw new PaymentError("POLICY_DENIED");
    await check(payment);
    const signature = sign(null, bytes(claims), privateKey).toString("base64url");
    return { decision: "allow", paymentDigest: digest,
      authorization: Buffer.from(canonicalJson({ claims, signature })).toString("base64url") };
  } };
}

/** Run in the isolated wallet service. The raw provider MUST NOT be exposed to the agent.
 * This is a guard around a provider, not an XRPL transaction encoder or ledger verifier. */
export function createGuardedWalletAdapter(publicKey: KeyObject, check: SigningBoundary,
  provider: PaymentAdapters["wallet"], now: () => Date = () => new Date()): PaymentAdapters["wallet"] {
  ed25519(publicKey, "public");
  return {
    async submit(payment, permit) {
      try {
        if (permit.authorization.length > 8192) throw new Error("oversized");
        const token = JSON.parse(Buffer.from(permit.authorization, "base64url").toString("utf8"));
        if (!token || Object.keys(token).sort().join(",") !== "claims,signature" ||
          typeof token.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(token.signature)) throw new Error("invalid");
        const claims = SigningPermitClaims.parse(token.claims), expected = claimsFor(payment);
        if (canonicalJson(claims) !== canonicalJson(expected) || permit.paymentDigest !== expected.paymentDigest ||
          Date.parse(claims.expiresAt) <= now().getTime() ||
          !verify(null, bytes(claims), publicKey, Buffer.from(token.signature, "base64url"))) throw new Error("invalid");
      } catch { throw new PaymentError("POLICY_DENIED"); }
      // The provider still owns durable one-transaction identity, exact signed-byte verification,
      // ledger lookup, and atomic ordering against revocation. Never retry unknown submissions.
      await check(payment);
      return provider.submit(payment, permit);
    },
    lookup: (payment, digest, txHash) => provider.lookup(payment, digest, txHash),
  };
}
