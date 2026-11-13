import { type KeyObject } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { type Wallet,type Payment } from 'xrpl';
import { canonicalJson,XRPL_TESTNET_WSS,RLUSD_CURRENCY_HEX,RLUSD_TESTNET_ISSUER } from '@shucamoxa/shared';
import { type PreparedTransfer,type PaymentAdapters,paymentDigest } from '../../payments/src/payment';
import { createGuardedWalletAdapter } from '../../payments/src/signing';
import { type PurchaseLedger,verifiedPurchaseOutcome } from './x402-execution';
type TransferLedger=PurchaseLedger&{broadcast(blob:string):Promise<void>};
type TransferGate=<T>(payment:PreparedTransfer,sign:()=>T)=>T;
type Record={payment:PreparedTransfer;tx:Payment;hash:string;blob:string};
/** Returns only the independently permit-checked adapter; no raw sign/broadcast method is exposed.
 * The host injects its provider wallet, policy PUBLIC key and authoritative synchronous DB gate. */
export function createTestnetTransferWallet(path:string,wallet:Wallet,policyPublicKey:KeyObject,
 ledger:TransferLedger,gate:TransferGate,now=()=>new Date()) {
 if(ledger.network!==XRPL_TESTNET_WSS)throw new Error('TESTNET_REQUIRED');
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS transfer_signatures(owner TEXT,id TEXT,body TEXT,PRIMARY KEY(owner,id));`);
 const read=(p:PreparedTransfer):Record|undefined=>{
  const row=db.prepare('SELECT body FROM transfer_signatures WHERE owner=? AND id=?').get(p.ownerId,p.intentId);
  if(!row)return undefined;const record=JSON.parse(row.body as string) as Record;
  if(paymentDigest(record.payment)!==paymentDigest(p))throw new Error('INTENT_MISMATCH');return record;
 };
 const lookup:PaymentAdapters['wallet']['lookup']=async(p,digest,txHash)=>{
  const record=read(p);if(!record||digest!==paymentDigest(p)||txHash&&txHash!==record.hash)return {status:'unknown',paymentDigest:digest};
  try{
   const result:any=await ledger.lookup(record.hash),outcome=verifiedPurchaseOutcome(result,record.tx,record.hash);
   if(outcome==='unknown')return {status:'submitted',paymentDigest:digest,txHash:record.hash};
   return {status:outcome,paymentDigest:digest,txHash:record.hash,validated:true,ledgerIndex:result.ledger_index,ledgerResult:result.meta.TransactionResult};
  }catch{return {status:'submitted',paymentDigest:digest,txHash:record.hash};}
 };
 const raw:PaymentAdapters['wallet']={lookup,submit:async(p,permit)=>{
  p=structuredClone(p);
  if(read(p))return lookup(p,paymentDigest(p));
  if(p.sourceAddress!==wallet.address||p.network!==XRPL_TESTNET_WSS||p.currency!==RLUSD_CURRENCY_HEX||
    p.issuer!==RLUSD_TESTNET_ISSUER||Date.parse(p.expiresAt)-now().getTime()<20_000)throw new Error('INTENT_MISMATCH');
  const metadata=await ledger.prepare(wallet.address);
  if(!Number.isSafeInteger(metadata.sequence)||metadata.sequence<1||!Number.isSafeInteger(metadata.ledger)||metadata.ledger<1)
    throw new Error('LEDGER_UNAVAILABLE');
  const tx:Payment={TransactionType:'Payment',Account:wallet.address,Destination:p.destination,
   Amount:{currency:p.currency,issuer:p.issuer,value:p.amount},Sequence:metadata.sequence,Fee:'100',LastLedgerSequence:metadata.ledger+4,
   Memos:[{Memo:{MemoType:Buffer.from('shucamoxa/log').toString('hex').toUpperCase(),MemoData:Buffer.from(p.auditHash).toString('hex').toUpperCase()}}],
   ...(p.destinationTag!==undefined?{DestinationTag:p.destinationTag}:{})};
  let record:Record|undefined,created=false;db.exec('BEGIN IMMEDIATE');
  try{
   record=read(p);
   if(!record){
    // The provider intentionally requires a dedicated transfer source: do not share its key
    // with the purchase host or any other signer. Serialize pending coordinator operations.
    const prior=db.prepare('SELECT body FROM transfer_signatures').all().map(row=>JSON.parse(row.body as string) as Record);
    if(prior.some(row=>row.tx.Account===wallet.address&&row.tx.Sequence===metadata.sequence))throw new Error('SEQUENCE_ALREADY_SIGNED');
    record=gate(p,()=>{
     if(Date.parse(p.expiresAt)-now().getTime()<20_000)throw new Error('INTENT_EXPIRED');
     const signed=wallet.sign(tx);return {payment:p,tx,hash:signed.hash,blob:signed.tx_blob};
    });
    db.prepare('INSERT INTO transfer_signatures VALUES(?,?,?)').run(p.ownerId,p.intentId,canonicalJson(record));created=true;
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  if(created){try{await ledger.broadcast(record.blob);}catch{/* Never sign another transaction or resubmit here. */}}
  return lookup(p,permit.paymentDigest);
 }};
 const guarded=createGuardedWalletAdapter(policyPublicKey,async p=>{gate(p,()=>{});},raw,now);
 return {...guarded,close:()=>db.close()};
}
