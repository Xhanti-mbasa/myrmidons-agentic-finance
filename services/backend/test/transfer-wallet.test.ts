import { afterEach,it,expect,vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Wallet,decode,hashes } from 'xrpl';
import { XRPL_TESTNET_WSS } from '@shucamoxa/shared';
import { PaymentService,type PaymentAdapters } from '../../payments/src/payment';
import { createSignedPolicyAdapter } from '../../payments/src/signing';
import { createTestnetTransferWallet } from '../src/transfer-wallet';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
const owner={ownerId:'business',subjectId:'human',role:'owner' as const},agent={...owner,subjectId:'agent',role:'agent' as const};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'signed-transfer-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
 const wallet=Wallet.generate(),recipient=Wallet.generate(),keys=generateKeyPairSync('ed25519');
 const now=()=>new Date('2026-11-13T12:00:00Z');let tx:any,hash='',unavailable=false;
 const ledger={network:XRPL_TESTNET_WSS as typeof XRPL_TESTNET_WSS,prepare:vi.fn(async()=>({sequence:1,ledger:100})),
  broadcast:vi.fn(async(blob:string)=>{tx=decode(blob);hash=hashes.hashSignedTx(blob);}),
  lookup:vi.fn(async()=>{if(unavailable)throw new Error('offline');return {hash,validated:true,ledger_index:101,tx_json:tx,
   meta:{TransactionResult:'tesSUCCESS',delivered_amount:tx.Amount}};})};
 const adapters={} as PaymentAdapters,service=new PaymentService(join(dir,'payments.db'),adapters,now);cleanup.push(()=>service.close());
 adapters.policy=createSignedPolicyAdapter(keys.privateKey,async p=>service.checkSigningBoundary(p),now);
 const provider=createTestnetTransferWallet(join(dir,'signer.db'),wallet,keys.publicKey,ledger,
  (p,sign)=>service.withSigningBoundary(p,sign),now);cleanup.push(()=>provider.close());adapters.wallet=provider;
 service.registerAccount(owner,{id:'treasury',address:wallet.address});
 service.approveRecipient(owner,{id:'supplier',kind:'vendor',address:recipient.address});
 const policy={enabled:true,perPaymentCap:'1.00',totalBudget:'1.00',recipientCaps:{}};service.setPolicy(owner,policy);
 const intent=(reference='INV-1',amount='1.00')=>service.createIntent(owner,{sourceAccountId:'treasury',recipientId:'supplier',amount,reference,
  executeAt:null,expiresAt:'2026-11-13T13:00:00Z'}).intentId;
 return {service,ledger,policy,intent,offline:()=>{unavailable=true;},online:()=>{unavailable=false;},tamper:()=>{tx={...tx,Fee:'1000'};}};
}
it('composes independently signed policy permits, a real wallet signature and exact ledger confirmation',async()=>{
 const f=fixture(),id=f.intent();expect((await f.service.pay(agent,{intentId:id})).status).toBe('settled');
 expect((await f.service.pay(agent,{intentId:id})).status).toBe('settled');expect(f.ledger.broadcast).toHaveBeenCalledTimes(1);
 expect((await f.service.pay(agent,{intentId:f.intent('INV-2')})).code).toBe('OVER_BUDGET');
});
it('rechecks revocation after network preparation and before actual signing',async()=>{
 const f=fixture();f.ledger.prepare.mockImplementationOnce(async()=>{f.service.setPolicy(owner,{...f.policy,enabled:false});return {sequence:1,ledger:100};});
 expect((await f.service.pay(agent,{intentId:f.intent()})).status).toBe('unknown');expect(f.ledger.broadcast).not.toHaveBeenCalled();
});
it('reconciles a persisted transaction without resubmitting and rejects mutated ledger fields',async()=>{
 const f=fixture(),id=f.intent();f.offline();expect((await f.service.pay(agent,{intentId:id})).status).toBe('submitted');
 f.online();f.tamper();expect((await f.service.reconcile(owner,id)).status).toBe('submitted');
 expect(f.ledger.broadcast).toHaveBeenCalledTimes(1);expect(f.ledger.prepare).toHaveBeenCalledTimes(1);
});
