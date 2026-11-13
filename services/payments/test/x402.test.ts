import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER } from '../../../packages/shared/src/constants';
import { bindPurchase, decodePaymentRequired, X402PurchaseService, type X402Adapters } from '../src/x402';
const owner = { ownerId:'owner',subjectId:'human',role:'owner' as const };
const agent = { ...owner,subjectId:'agent',role:'agent' as const };
const now = new Date('2026-11-13T12:00:00Z');
const merchant = { id:'demo',origin:'https://merchant.example',payTo:RLUSD_TESTNET_ISSUER,
  facilitator:'https://x402.org/facilitator' as const,termsUrl:'https://merchant.example/terms' };
const challenge = () => ({ x402Version:2,resource:{url:'https://merchant.example/article/1'},accepts:[{
  scheme:'exact',network:'xrpl:1',asset:RLUSD_CURRENCY_HEX,payTo:merchant.payTo,amount:'0.005',maxTimeoutSeconds:60,
  extra:{issuer:RLUSD_TESTNET_ISSUER,areFeesSponsored:false,assetTransferMethod:'sequence',invoiceId:'article1'} }] });
const bind = (id='11111111-1111-4111-8111-111111111111') => bindPurchase({purchaseId:id,ownerId:owner.ownerId,
  categoryId:'articles',requestedUrl:challenge().resource.url,challenge:challenge(),merchant,receivedAt:now});
const paths:string[]=[]; const services:X402PurchaseService[]=[];
afterEach(()=>{ services.splice(0).forEach(s=>s.close()); paths.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})); });
function setup() {
  const path=mkdtempSync(join(tmpdir(),'x402-'));paths.push(path);
  const adapters:X402Adapters={budget:{status:vi.fn(()=> 'none' as const),reserve:vi.fn(()=>({budgetDigest:'reserved'})),authorize:vi.fn(()=>({budgetDigest:'reserved'})),
    reconcile:vi.fn(()=> 'settled' as const)},execution:{execute:vi.fn(async()=>({validated:true})),lookup:vi.fn(async()=>({validated:true})),deliver:vi.fn(async()=>true)}};
  const open=()=>{const service=new X402PurchaseService(join(path,'p.db'),adapters,()=>now);services.push(service);return service;};
  return {adapters,open,service:open()};
}
describe('x402 restricted challenge profile',()=>{
  it('decodes official v2 shape and preserves IOU decimal amount',()=>{
    const decoded=decodePaymentRequired(Buffer.from(JSON.stringify(challenge())).toString('base64'));
    expect(decoded.accepts[0]!.amount).toBe('0.005'); expect(bind().resourceHash).toHaveLength(64);
  });
  it.each(['network','asset','issuer','origin','resource','recipient','fee','extensions'])( 'rejects changed %s',field=>{
    const c=challenge();
    if(field==='network')c.accepts[0]!.network='xrpl:0';
    if(field==='asset')c.accepts[0]!.asset='USD';
    if(field==='issuer')c.accepts[0]!.extra.issuer='malicious';
    if(field==='origin')c.resource.url='https://evil.example/article/1';
    if(field==='resource')c.resource.url='https://merchant.example/article/2';
    if(field==='recipient')c.accepts[0]!.payTo='malicious';
    if(field==='fee')c.accepts[0]!.extra.areFeesSponsored=true;
    if(field==='extensions')Object.assign(c.accepts[0]!.extra,{override:true});
    expect(()=>bindPurchase({purchaseId:bind().purchaseId,ownerId:'owner',categoryId:'articles',requestedUrl:challenge().resource.url,
      challenge:c,merchant,receivedAt:now})).toThrow();
  });
});
describe('durable purchase boundary with simulated merchant/signing adapters',()=>{
  it('delivers once, deduplicates concurrent callers and survives restart',async()=>{
    const {service,open,adapters}=setup(),b=bind();
    await Promise.all([service.purchase(owner,b,'pay'),service.purchase(owner,b,'pay')]);
    expect((await open().purchase(owner,b,'pay')).status).toBe('delivered');expect(adapters.execution.execute).toHaveBeenCalledTimes(1);
  });
  it('explicit decline never reserves; agent explicit pay awaits owner',async()=>{
    const {service,adapters}=setup();expect((await service.purchase(agent,bind(),'pay')).status).toBe('awaiting_owner');
    expect((await service.purchase(owner,bind(),'decline')).status).toBe('declined');expect(adapters.budget.reserve).not.toHaveBeenCalled();
  });
  it('blocks overspend at mandatory independent budget before execution',async()=>{
    const {service,adapters}=setup();vi.mocked(adapters.budget.reserve).mockImplementation(()=>{throw new Error('WEEKLY_LIMIT');});
    await expect(service.purchase(agent,bind(),'automatic')).rejects.toThrow('WEEKLY_LIMIT');expect(adapters.execution.execute).not.toHaveBeenCalled();
  });
  it('retains unknown on transport failure and only lookup reconciles',async()=>{
    const {service,open,adapters}=setup();vi.mocked(adapters.execution.execute).mockRejectedValue(new Error('timeout'));
    expect((await service.purchase(owner,bind(),'pay')).status).toBe('unknown');
    expect((await open().purchase(owner,bind(),'pay')).status).toBe('unknown');expect(adapters.execution.execute).toHaveBeenCalledTimes(1);
    expect((await service.reconcile(owner,bind())).status).toBe('delivered');
  });
  it('retries delivery without another payment',async()=>{
    const {service,adapters}=setup();vi.mocked(adapters.execution.deliver).mockResolvedValueOnce(false);
    expect((await service.purchase(owner,bind(),'pay')).status).toBe('delivery_failed');
    expect((await service.reconcile(owner,bind())).status).toBe('delivered');expect(adapters.execution.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects substituted binding and cross-owner authorization',async()=>{
    const {service}=setup();await expect(service.purchase({...owner,ownerId:'other'},bind(),'pay')).rejects.toThrow('PURCHASE_MISMATCH');
    await expect(service.purchase(owner,{...bind(),categoryId:'free'},'pay')).rejects.toThrow('PURCHASE_MISMATCH');
  });
});

import { PurchaseBudgetService } from '../src/purchase-budgets';
import { x402BudgetAdapter } from '../src/x402-budget';
it('composes actual durable weekly budget with a controlled simulated merchant',async()=>{
  const {service:unused,adapters}=setup();
  const path=mkdtempSync(join(tmpdir(),'x402-budget-'));paths.push(path);
  const budget=new PurchaseBudgetService(join(path,'b.db'),{
    quotes:{resolve:()=>({id:'quote',source:'controlled-test-quote',zarPerRlusd:'20',issuedAt:'2026-11-13T11:00:00Z',expiresAt:'2026-11-13T13:00:00Z'})},
    outcomes:{verify:()=> 'settled'},
  },()=>now);
  budget.setPolicy(owner,{enabled:true,categories:{articles:{perPurchaseZar:'0.10',weeklyZar:'0.10',merchantIds:['demo'],autoPurchase:true}}});
  const composed=new X402PurchaseService(join(path,'p.db'),{...adapters,budget:x402BudgetAdapter(budget,()=>({quoteId:'quote',feeRlusd:'0'}))},()=>now);
  services.push(composed);
  try {
    expect((await composed.purchase(agent,bind(),'automatic')).status).toBe('delivered');
    const c=challenge();c.resource.url='https://merchant.example/article/2';
    const b=bindPurchase({purchaseId:'22222222-2222-4222-8222-222222222222',ownerId:'owner',categoryId:'articles',requestedUrl:c.resource.url,challenge:c,merchant,receivedAt:now});
    await expect(composed.purchase(agent,b,'automatic')).rejects.toThrow('OVER_WEEKLY_BUDGET');
    expect(adapters.execution.execute).toHaveBeenCalledTimes(1);
    expect(budget.remaining(owner,'articles').remainingZar).toBe('0.000000');
  } finally { budget.close(); }
});
it('keeps delivered terminal when an older concurrent lookup returns unknown',async()=>{
  const {service,adapters}=setup();let complete!:(v:unknown)=>void,lookup!:(v:unknown)=>void;
  vi.mocked(adapters.execution.execute).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  vi.mocked(adapters.execution.lookup).mockImplementation(()=>new Promise(resolve=>{lookup=resolve;}));
  vi.mocked(adapters.budget.reconcile).mockImplementation((_ctx,_binding,evidence)=>evidence==='old'?'unknown':'settled');
  const payment=service.purchase(owner,bind(),'pay'); const reconcile=service.reconcile(owner,bind());
  complete('new');expect((await payment).status).toBe('delivered');lookup('old');
  expect((await reconcile).status).toBe('delivered');
});
it('refuses another purchase id for the same resource',async()=>{
  const {service,adapters}=setup();await service.purchase(owner,bind(),'pay');
  await expect(service.purchase(owner,bind('22222222-2222-4222-8222-222222222222'),'pay')).rejects.toThrow('PURCHASE_MISMATCH');
  expect(adapters.execution.execute).toHaveBeenCalledTimes(1);
});
