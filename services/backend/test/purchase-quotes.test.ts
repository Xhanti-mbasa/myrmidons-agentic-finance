import { describe,it,expect } from 'vitest';
import { generateKeyPairSync,sign } from 'node:crypto';
import { canonicalJson } from '@shucamoxa/shared';
import { verifyPurchaseQuote } from '../src/purchase-quotes';
describe('owner-attested rate and fee envelope',()=>{
 const now=new Date('2026-11-13T12:00:00Z');
 const claims={quote:{id:'quote',source:'owner-reviewed-rate',zarPerRlusd:'20',issuedAt:'2026-11-13T11:59:00Z',expiresAt:'2026-11-13T12:04:00Z'},maxFeeDrops:'100',feeRlusd:'0.0001'};
 it('accepts only current quotes signed by the configured publisher',()=>{
  const keys=generateKeyPairSync('ed25519');
  const packet={claims,signature:sign(null,Buffer.from(canonicalJson(claims)),keys.privateKey).toString('base64url')};
  expect(verifyPurchaseQuote(packet,keys.publicKey,now)).toEqual(claims);
  expect(()=>verifyPurchaseQuote(packet,generateKeyPairSync('ed25519').publicKey,now)).toThrow('QUOTE_SIGNATURE_INVALID');
  expect(()=>verifyPurchaseQuote(packet,keys.publicKey,new Date('2026-11-13T12:04:00Z'))).toThrow('QUOTE_EXPIRED');
  expect(()=>verifyPurchaseQuote({...packet,claims:{...claims,feeRlusd:'0.000001'}},keys.publicKey,now)).toThrow('QUOTE_SIGNATURE_INVALID');
  expect(()=>verifyPurchaseQuote({...packet,claims:{...claims,quote:{...claims.quote,zarPerRlusd:'1'}}},keys.publicKey,now)).toThrow('QUOTE_SIGNATURE_INVALID');
 });
 it('rejects validly signed quotes with excessive lifetime',()=>{
  const keys=generateKeyPairSync('ed25519'),long={...claims,quote:{...claims.quote,expiresAt:'2026-11-14T12:00:00Z'}};
  const packet={claims:long,signature:sign(null,Buffer.from(canonicalJson(long)),keys.privateKey).toString('base64url')};
  expect(()=>verifyPurchaseQuote(packet,keys.publicKey,now)).toThrow('QUOTE_EXPIRED');
 });
});
