import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { Wallet, decode } from 'xrpl';
import { RLUSD_CURRENCY_HEX,RLUSD_TESTNET_ISSUER,XRPL_TESTNET_WSS,canonicalJson } from '@shucamoxa/shared';
import { PurchaseBudgetService } from '../../payments/src/purchase-budgets';
import { X402PurchaseService,bindPurchase,type PurchaseBinding } from '../../payments/src/x402';
import { X402MerchantClient } from '../../payments/src/x402-merchant';
import { x402BudgetAdapter } from '../../payments/src/x402-budget';
import { TestnetPurchaseExecutor,TestnetPurchaseLedger,verifiedPurchaseOutcome,type PurchaseLedger } from '../src/x402-execution';
import { createPurchaseHost } from '../src/purchase-host';
import { once } from 'node:events';
import type { Principal } from '../../payments/src/payment';
const owner={ownerId:'business',subjectId:'human',role:'owner' as const};
const agent={...owner,subjectId:'agent',role:'agent' as const};
const cleanup:(()=>void)[]=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'guarded-purchase-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
 const wallet=Wallet.generate(),receiver=Wallet.generate();let time=new Date('2026-11-13T12:00:00Z');
 let tx:any,hash:string,fee='0.000001',tamper=false,result='tesSUCCESS';
 const merchant={id:'publisher',origin:'https://publisher.example',payTo:receiver.address,
  facilitator:'https://xrpl-facilitator-testnet.t54.ai' as const,termsUrl:'https://publisher.example/terms'};
 const binding=(path='/article/1')=>{
  const url=merchant.origin+path;
  return bindPurchase({purchaseId:randomUUID(),ownerId:owner.ownerId,categoryId:'articles',requestedUrl:url,merchant,receivedAt:time,
   challenge:{x402Version:2,resource:{url},accepts:[{scheme:'exact',network:'xrpl:1',asset:RLUSD_CURRENCY_HEX,
    payTo:receiver.address,amount:'0.005',maxTimeoutSeconds:120,extra:{issuer:RLUSD_TESTNET_ISSUER,sourceTag:804681468,invoiceId:path}}]}});
 };
 const policy={enabled:true,aggregateRlusd:{perPurchase:'0.006',lifetimeBudget:'0.010002'},categories:{articles:{
  perPurchaseZar:'0.11',periodBudgetZar:'0.22',period:'weekly',merchantIds:['publisher'],autoPurchase:true}}};
 let executor:TestnetPurchaseExecutor;
 const budget=new PurchaseBudgetService(join(dir,'budget.db'),{
  quotes:{resolve:id=>({id,source:'signed-fixture',zarPerRlusd:'20',issuedAt:'2026-11-13T11:59:00Z',expiresAt:'2026-11-13T12:05:00Z'})},
  outcomes:{verify:(r,e)=>executor.verifyOutcome(r,e),verifyAbsent:(o,id)=>executor.verifyAbsent(o,id),rejectedFeeRlusd:r=>executor.rejectedFeeRlusd(r)},
 },()=>time);cleanup.push(()=>budget.close());budget.setPolicy(owner,policy);
 const ledger:PurchaseLedger={network:XRPL_TESTNET_WSS,prepare:vi.fn(async()=>({sequence:1,ledger:100})),lookup:vi.fn(async()=>({
  hash,validated:true,ledger_index:101,tx_json:tamper?{...tx,Destination:wallet.address}:tx,
  meta:{TransactionResult:result,delivered_amount:{currency:RLUSD_CURRENCY_HEX,issuer:RLUSD_TESTNET_ISSUER,value:'0.005'}}}))};
 const fetcher=vi.fn(async(_url:unknown,init:any)=>{
  const payload=JSON.parse(Buffer.from(init.headers['payment-signature'],'base64').toString());
  expect(payload.accepted.extra.sourceTag).toBe(804681468);
  tx=decode(payload.payload.signedTxBlob);hash=wallet.sign((()=>{const v={...tx};delete v.TxnSignature;delete v.SigningPubKey;return v;})() as any).hash;
  return new Response('paid article');
 });
 const open=()=>new TestnetPurchaseExecutor(join(dir,'signer.db'),wallet,ledger,
  (b,d,sign)=>budget.withSigningAuthority(agent,b.purchaseId,d,sign),()=>new X402MerchantClient(merchant,fetcher as typeof fetch),
  '100','0.000001',()=>time);
 executor=open();cleanup.push(()=>executor.close());
 const adapter=x402BudgetAdapter(budget,()=>({quoteId:'quote',feeRlusd:fee}));
 const service=new X402PurchaseService(join(dir,'purchases.db'),{budget:adapter,execution:executor},()=>time);
 cleanup.push(()=>service.close());
 return {budget,executor,service,binding,policy,ledger,fetcher,open,adapter,
  tamper:()=>{tamper=true;},reject:()=>{result='tecUNFUNDED_PAYMENT';}, advance:()=>{time=new Date('2026-11-16T12:00:00Z');}, lowFee:()=>{fee='0';}};
}
describe('actual signing and independent budget composition (scripted ledger/merchant)',()=>{
 it('re-resolves approved merchant destination even if the caller recalculates its binding digest',async()=>{
  const f=fixture(),b=f.binding();f.adapter.reserve(agent,b);const auth=f.adapter.authorize(agent,b);
  const changed=structuredClone(b);changed.challenge.accepts[0]!.payTo=Wallet.generate().address;
  const {digest,...data}=changed;const substituted={...data,digest:createHash('sha256').update(canonicalJson(data)).digest('hex')};
  await expect(f.executor.execute(substituted,auth.budgetDigest)).rejects.toThrow('MERCHANT_MISMATCH');
  expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('retains the conservative network fee charge after a validated ledger rejection',async()=>{
  const f=fixture();f.reject();const b=f.binding();
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('blocked');
  expect(f.budget.remaining(owner,'articles')).toMatchObject({spentZar:'0.000020',reservedZar:'0.000000'});
  expect(f.executor.content(b)).toBeUndefined();
 });
 it('keeps owner approvals outside agent credentials through an actual HTTP host',async()=>{
  const f=fixture(),b=f.binding(),store=new Map<string,PurchaseBinding>();
  const ownerToken='owner-token-'.repeat(4),agentToken='agent-token-'.repeat(4);
  const server=createPurchaseHost({credentials:new Map<string,Principal>([[ownerToken,owner],[agentToken,agent]]),
   resources:new Map([['article',{url:b.resourceUrl,categoryId:b.categoryId,merchant:{id:'publisher',origin:'https://publisher.example',
    payTo:b.challenge.accepts[0]!.payTo,facilitator:'https://xrpl-facilitator-testnet.t54.ai',termsUrl:'https://publisher.example/terms'}}]]),
   budget:f.budget,service:f.service,load:(o,id)=>o===b.ownerId?store.get(id):undefined,
   find:(o,url)=>[...store.values()].find(item=>item.ownerId===o&&item.resourceUrl===url),save:b=>{store.set(b.purchaseId,b);},
   content:b=>f.executor.content(b),client:()=>({challenge:async()=>b}) as unknown as X402MerchantClient});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new Error('listener');
  const base=`http://127.0.0.1:${address.port}`;
  const post=(path:string,body:unknown,token=agentToken,method='POST')=>fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
   expect((await post('/purchases',{resourceId:'article',decision:'automatic'},'forged')).status).toBe(401);
   expect((await post('/purchases/policy',{...f.policy,enabled:false},agentToken,'PUT')).status).toBe(403);
   expect((await post('/purchases',{resourceId:'article',decision:'automatic',ownerId:'other'})).status).toBe(400);
   const awaiting=await (await post('/purchases',{resourceId:'article',decision:'pay'})).json();
   expect(awaiting.status).toBe('awaiting_owner');expect(f.fetcher).not.toHaveBeenCalled();
   expect((await post('/purchases/approve',{purchaseId:b.purchaseId})).status).toBe(403);
   expect((await (await post('/purchases/approve',{purchaseId:b.purchaseId},ownerToken)).json()).status).toBe('delivered');
   expect(await (await post('/purchases/content',{purchaseId:b.purchaseId})).text()).toBe('paid article');
   expect(f.fetcher).toHaveBeenCalledTimes(1);
  }finally{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
 });
 it('signs once, verifies exact ledger evidence, delivers and blocks the first overspend',async()=>{
  const f=fixture(),b=f.binding();
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('delivered');
  expect(new TextDecoder().decode(f.executor.content(b))).toBe('paid article');
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('delivered');
  expect((await f.service.purchase(agent,f.binding('/article/2'),'automatic')).status).toBe('delivered');
  await expect(f.service.purchase(agent,f.binding('/article/3'),'automatic')).rejects.toThrow('OVER_PERIOD_BUDGET');
  expect(f.fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not release paid content or budget on substituted ledger evidence',async()=>{
  const f=fixture();f.tamper();const b=f.binding();
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('unknown');
  expect(f.executor.content(b)).toBeUndefined();
  expect(f.budget.remaining(owner,'articles').reservedZar).toBe('0.100020');
 });
 it('serializes revocation with the signing gate and recovers no-sign reservations',async()=>{
  const f=fixture(),b=f.binding();f.adapter.reserve(agent,b);const auth=f.adapter.authorize(agent,b);
  f.budget.setPolicy(owner,{...f.policy,enabled:false});
  await expect(f.executor.execute(b,auth.budgetDigest)).rejects.toThrow('KILL_SWITCH_ON');
  await f.executor.lookup(b);
  expect(f.adapter.reconcile(agent,b,{})).toBe('rejected');
  await expect(f.executor.execute(b,auth.budgetDigest)).rejects.toThrow('PURCHASE_CLOSED');
  expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('recovers a crash after reservation and before purchase authorization without signing',async()=>{
  const f=fixture(),b=f.binding();
  const original=f.adapter.authorize;f.adapter.authorize=()=>{throw new Error('simulated-crash');};
  await expect(f.service.purchase(agent,b,'automatic')).rejects.toThrow('simulated-crash');
  expect(f.budget.remaining(owner,'articles').reservedZar).toBe('0.100020');
  expect((await f.service.reconcile(owner,b)).status).toBe('blocked');
  expect(f.budget.remaining(owner,'articles').reservedZar).toBe('0.000000');
  f.adapter.authorize=original;
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('blocked');
  expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('requires a global mandate and conservative fee allowance at the signer',async()=>{
  const f=fixture();f.lowFee();
  expect((await f.service.purchase(agent,f.binding(),'automatic')).status).toBe('unknown');
  expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('does not resubmit after delivery failure; restart lookup uses the persisted hash',async()=>{
  const f=fixture(),b=f.binding();f.fetcher.mockImplementationOnce(async()=>{throw new Error('offline');});
  expect((await f.service.purchase(agent,b,'automatic')).status).toBe('unknown');
  const restart=f.open();cleanup.push(()=>restart.close());
  await restart.execute(b,'ignored-on-recovery');
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.ledger.prepare).toHaveBeenCalledTimes(1);
 });
});
it('rejects unverified and malformed ledger outcomes',()=>{
 expect(verifiedPurchaseOutcome({validated:true},{} as any,'A'.repeat(64))).toBe('unknown');
});
it('pins HTTPS RPC to Testnet and refuses a different reported network before any signing',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({result:{info:{network_id:0,server_state:'full'}}})))
  .mockResolvedValueOnce(new Response(JSON.stringify({result:{info:{network_id:1,server_state:'full'}}})));
 vi.stubGlobal('fetch',fetcher);
 try{
  const ledger=new TestnetPurchaseLedger();await expect(ledger.connect()).rejects.toThrow('TESTNET_UNAVAILABLE');
  await ledger.connect();expect(fetcher.mock.calls[0]?.[0]).toBe('https://s.altnet.rippletest.net:51234/');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'manual'});await ledger.close();
 }finally{vi.unstubAllGlobals();}
});
