import { verify,type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { TrustedPurchaseQuote,PositiveMicroAmount,canonicalJson } from '@shucamoxa/shared';

export const SignedPurchaseQuote = z.strictObject({
  quote:TrustedPurchaseQuote,
  maxFeeDrops:z.string().regex(/^[1-9]\d{0,3}$/).refine(v=>BigInt(v)<=1000n),
  feeRlusd:PositiveMicroAmount,
});
/** Owner-controlled quote publisher signs the rate AND fee ceilings; the agent cannot submit rates.
 * This accepts attested quotes, not a claim that USD and RLUSD trade at parity. */
export function verifyPurchaseQuote(packet:unknown,publicKey:KeyObject,now=new Date()) {
  const envelope=z.strictObject({claims:SignedPurchaseQuote,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).parse(packet);
  if (publicKey.type!=='public'||publicKey.asymmetricKeyType!=='ed25519'||
    !verify(null,Buffer.from(canonicalJson(envelope.claims)),publicKey,Buffer.from(envelope.signature,'base64url')))
    throw new Error('QUOTE_SIGNATURE_INVALID');
  const q=envelope.claims.quote,issued=Date.parse(q.issuedAt),expires=Date.parse(q.expiresAt);
  if(issued>now.getTime()||expires<=now.getTime()||expires-issued>300_000||expires<=issued)
    throw new Error('QUOTE_EXPIRED');
  return envelope.claims;
}
