import { lstatSync,readFileSync,mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Wallet } from 'xrpl';
import { z } from 'zod';
import { AccountId,PurchaseBudgetPolicy,XrplAddress,canonicalJson } from '@shucamoxa/shared';
import { PurchaseBudgetService } from '../../payments/src/purchase-budgets';
import { x402BudgetAdapter } from '../../payments/src/x402-budget';
import { X402PurchaseService,type PurchaseBinding } from '../../payments/src/x402';
import { X402MerchantClient } from '../../payments/src/x402-merchant';
import { TestnetPurchaseExecutor,TestnetPurchaseLedger } from './x402-execution';
import { verifyPurchaseQuote } from './purchase-quotes';
import { createPurchaseHost } from './purchase-host';
import type { Principal } from '../../payments/src/payment';

const https=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;});
const configSchema=z.strictObject({ownerId:AccountId,stateDirectory:z.string(),payerSeedFile:z.string(),
 ownerTokenFile:z.string(),agentTokenFile:z.string(),quotePublicKeyFile:z.string(),quoteFile:z.string(),
 policy:PurchaseBudgetPolicy,resources:z.record(AccountId,z.strictObject({categoryId:AccountId,url:https,
 merchant:z.strictObject({id:AccountId,origin:https,payTo:XrplAddress,destinationTag:z.number().int().nonnegative().max(4294967295).optional(),
 facilitator:z.enum(['https://xrpl-facilitator-testnet.t54.ai','https://x402.org/facilitator']),termsUrl:https})}))});
function privateFile(path:string):string{
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('PRIVATE_FILE_REQUIRED');
 return readFileSync(path,'utf8').trim();
}
async function main(){
 if(process.argv[2]==='--preflight'){
  const ledger=new TestnetPurchaseLedger();try{await ledger.connect();console.log('XRPL Testnet connection available; no wallet loaded and no payment submitted.');}
  finally{await ledger.close();}return;
 }
 if(process.argv.length!==3)throw new Error('Expected private configuration path');
 const config=configSchema.parse(JSON.parse(privateFile(resolve(process.argv[2]!))));
 mkdirSync(config.stateDirectory,{recursive:true,mode:0o700});
 const state=lstatSync(config.stateDirectory);
 if(!state.isDirectory()||state.isSymbolicLink()||(state.mode&0o077)!==0)throw new Error('PRIVATE_STATE_REQUIRED');
 process.umask(0o077);
 const owner={ownerId:config.ownerId,subjectId:'human',role:'owner' as const};
 const agent={...owner,subjectId:'agent',role:'agent' as const};
 const key=createPublicKey(readFileSync(config.quotePublicKeyFile));
 const quote=()=>verifyPurchaseQuote(JSON.parse(privateFile(config.quoteFile)),key);
 const initial=quote(); // Startup refuses expired, unsigned or unbounded rates/fee valuations.
 const ownerToken=privateFile(config.ownerTokenFile),agentToken=privateFile(config.agentTokenFile);
 if(ownerToken===agentToken)throw new Error('DISTINCT_CREDENTIALS_REQUIRED');
 const registry=new Map(Object.entries(config.resources));
 const journal=new DatabaseSync(join(config.stateDirectory,'bindings.db'));
 journal.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS bindings(owner TEXT,id TEXT,url TEXT,body TEXT,PRIMARY KEY(owner,id),UNIQUE(owner,url));`);
 const load=(ownerId:string,id:string)=>{const row=journal.prepare('SELECT body FROM bindings WHERE owner=? AND id=?').get(ownerId,id);return row?JSON.parse(row.body as string) as PurchaseBinding:undefined;};
 const find=(ownerId:string,url:string)=>{const row=journal.prepare('SELECT body FROM bindings WHERE owner=? AND url=?').get(ownerId,url);return row?JSON.parse(row.body as string) as PurchaseBinding:undefined;};
 const ledger=new TestnetPurchaseLedger();let executor:TestnetPurchaseExecutor;
 const budgetPath=join(config.stateDirectory,'budgets.db');
 const budget=new PurchaseBudgetService(budgetPath,{
  quotes:{resolve:id=>{const q=quote();if(q.quote.id!==id)throw new Error('QUOTE_UNAVAILABLE');return q.quote;}},
  outcomes:{verify:(r,e)=>executor.verifyOutcome(r,e),verifyAbsent:(o,id)=>executor.verifyAbsent(o,id),
   rejectedFeeRlusd:r=>executor.rejectedFeeRlusd(r)},
 });
 // Initialize only on first installation. Restarts do not silently replace owner policy/version.
 const check=new DatabaseSync(budgetPath);const exists=check.prepare('SELECT owner FROM purchase_policy WHERE owner=?').get(config.ownerId);check.close();
 if(!exists)budget.setPolicy(owner,config.policy);
 executor=new TestnetPurchaseExecutor(join(config.stateDirectory,'signer.db'),Wallet.fromSeed(privateFile(config.payerSeedFile)),ledger,
  (b,d,sign)=>{if(b.ownerId!==config.ownerId)throw new Error('NOT_AUTHORIZED');return budget.withSigningAuthority(agent,b.purchaseId,d,sign);},
  b=>{const r=[...registry.values()].find(r=>r.url===b.resourceUrl&&r.merchant.id===b.merchantId);if(!r)throw new Error('MERCHANT_NOT_APPROVED');return new X402MerchantClient(r.merchant);},
  initial.maxFeeDrops,initial.feeRlusd);
 const service=new X402PurchaseService(join(config.stateDirectory,'purchases.db'),{budget:x402BudgetAdapter(budget,()=>{
  const q=quote();if(q.maxFeeDrops!==initial.maxFeeDrops||q.feeRlusd!==initial.feeRlusd)throw new Error('FEE_CONFIG_CHANGED_RESTART_REQUIRED');
  return {quoteId:q.quote.id,feeRlusd:q.feeRlusd};}),execution:executor});
 await ledger.connect();
 const server=createPurchaseHost({credentials:new Map<string,Principal>([[ownerToken,owner],[agentToken,agent]]),resources:registry,budget,service,load,find,
  save:b=>{journal.prepare('INSERT INTO bindings VALUES(?,?,?,?) ON CONFLICT(owner,id) DO NOTHING').run(b.ownerId,b.purchaseId,b.resourceUrl,canonicalJson(b));},
  content:b=>executor.content(b)});
 server.requestTimeout=15_000;server.headersTimeout=10_000;
 server.listen(8090,'127.0.0.1',()=>console.log('Private Testnet purchase host listening on 127.0.0.1:8090.'));
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{service.close();executor.close();budget.close();journal.close();void ledger.close();});};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
void main().catch(()=>{console.error('Purchase host refused startup. Check private configuration, signed quote, Testnet funding and connection; no automatic payment retry.');process.exitCode=1;});
