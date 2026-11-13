import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createPolicyServer } from '../services/policy/src/server';
import { RLUSD_CURRENCY_HEX,RLUSD_TESTNET_ISSUER,XRPL_TESTNET_WSS,type Rules } from '../packages/shared/src/index';
import { verifiedPurchaseOutcome } from '../services/backend/src/x402-execution';
import { fixture,agent } from './fixture';
const {Wallet,decode}=createRequire(new URL('../services/policy/package.json',import.meta.url))('xrpl');

/** Actual co-sign HTTP application and real local multisignatures. No ledger or fake co-signer. */
export async function policyVector(id:string,vector:Record<string,any>) {
 const treasury=Wallet.generate(),signer=Wallet.generate(),policy=Wallet.generate(),supplier=Wallet.generate();
 const token=randomBytes(32).toString('hex');
 const rules:Rules={perPaymentCap:'10.00',totalBudget:'100.00',spent:'0.00',reserved:'0.00',remaining:'100.00',
  periodStart:'2026-11-01',killSwitch:false,suppliers:[{id:'sup_supplier',name:'Supplier'}]};
 const {app}=createPolicyServer({env:{POLICY_SEED:policy.seed,POLICY_CALLER_TOKEN:token,
  AGENT_ACCOUNT:signer.address,TREASURY_ACCOUNT:treasury.address,XRPL_WSS:XRPL_TESTNET_WSS},rulesReader:()=>rules,logger:()=>{}});
 const base:any={TransactionType:'Payment',Account:treasury.address,Destination:supplier.address,
  Amount:{currency:RLUSD_CURRENCY_HEX,issuer:RLUSD_TESTNET_ISSUER,value:'1'},Fee:'12',Flags:0,
  Sequence:1,LastLedgerSequence:100,DestinationTag:0,SigningPubKey:'',Memos:[{Memo:{MemoType:'6175646974',MemoData:'616263'}}]};
 const bodyFor=(tx:any)=>{
  const blob=signer.sign(tx,true).tx_blob,{Signers,...json}=decode(blob);
  return {txJson:json,agentSignedBlob:blob,request:{supplierId:'sup_supplier',amount:'1.00',invoiceNumber:'INV-1',logEntryHash:'a'.repeat(64)}};
 };
 const post=async(body:unknown)=>{
  const response=await app.request('/cosign',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return response.json() as Promise<any>;
 };
 if((await post(bodyFor(base))).decision!=='allow')throw new Error('Valid policy positive control failed');
 let changed={...base};
 const type=vector.TransactionType;
 if(type&&type!=='Payment'){
  changed={TransactionType:type,Account:treasury.address,Fee:'12',Sequence:1,SigningPubKey:''};
  if(type==='SignerListSet')Object.assign(changed,{SignerQuorum:1,SignerEntries:[{SignerEntry:{Account:supplier.address,SignerWeight:1}}]});
  if(type==='SetRegularKey')changed.RegularKey=supplier.address;
  if(type==='AccountSet')changed.SetFlag=8;
  if(type==='TrustSet')changed.LimitAmount=base.Amount;
  if(type==='OfferCreate')Object.assign(changed,{TakerGets:'100',TakerPays:base.Amount});
 }else if(id==='XRPL-14'){
  const body=bodyFor(base);body.txJson={...body.txJson,Destination:treasury.address};
  return {safe:(await post(body)).decision==='block',observation:'Actual policy endpoint checked supplied JSON against decoded multisigned bytes; no ledger submission.'};
 }else if(id==='XRPL-15'){
  const body=bodyFor(base),first=await post(body),second=await post(body);
  return {safe:first.decision==='block'||second.decision==='block',observation:'Authenticated T20 endpoint accepted the same signed request twice; it has no durable permit replay store. No ledger submission or double-spend claim.'};
 }else if(id==='XRPL-16'){
  rules.killSwitch=true;
 }else{
  for(const [key,value] of Object.entries(vector))if(!['Account','Destination','TransactionType','SigningPubKey'].includes(key))changed[key]=value;
 }
 const result=await post(bodyFor(changed));
 return {safe:result.decision==='block',observation:result.decision==='block'
  ?'Actual T20 policy application refused the multisigned mutation; local signatures only, no ledger submission.'
  :'Actual T20 policy application co-signed the mutation: only kill-switch/type/source checks are installed. Do not use this incomplete endpoint as the transfer or purchase signing gate.'};
}
export async function unknownReservationVector(){
 const f=fixture();f.wallet.submit.mockRejectedValueOnce(new Error('simulated transport failure'));
 const first=await f.service.pay(agent,{intentId:f.create()});
 const second=await f.service.pay(agent,{intentId:f.create({reference:'INV-2'})});
 return {safe:first.status==='unknown'&&second.code==='OVER_BUDGET',observation:'Real SQLite coordinator retained capacity after simulated wallet transport failure; no ledger submission or deployed-signer proof.'};
}
export function deliveredAmountVector(){
 const sender=Wallet.generate(),receiver=Wallet.generate();
 const tx={TransactionType:'Payment',Account:sender.address,Destination:receiver.address,
  Amount:{currency:RLUSD_CURRENCY_HEX,issuer:RLUSD_TESTNET_ISSUER,value:'1'},Fee:'12',Sequence:1,LastLedgerSequence:100};
 const signed=sender.sign(tx),json=decode(signed.tx_blob);
 const good={validated:true,hash:signed.hash,ledger_index:10,tx_json:json,meta:{TransactionResult:'tesSUCCESS',delivered_amount:tx.Amount}};
 if(verifiedPurchaseOutcome(good,tx as any,signed.hash)!=='settled')throw new Error('Ledger-verifier positive control failed');
 const bad={...good,meta:{...good.meta,delivered_amount:{...tx.Amount,value:'0.001'}}};
 return {safe:verifiedPurchaseOutcome(bad,tx as any,signed.hash)==='unknown',observation:'Actual production receipt verifier rejected underdelivery against a real local signed transaction and scripted metadata; no live ledger evidence.'};
}
