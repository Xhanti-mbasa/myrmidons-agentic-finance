import { createServer,type IncomingMessage } from 'node:http';
import { createHash,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AccountId,PurchaseBudgetPolicy } from '@shucamoxa/shared';
import { type Principal } from '../../payments/src/payment';
import { X402PurchaseService,type PurchaseBinding,type Merchant } from '../../payments/src/x402';
import { X402MerchantClient } from '../../payments/src/x402-merchant';
import { PurchaseBudgetService } from '../../payments/src/purchase-budgets';

export type PurchaseResource={merchant:Merchant;categoryId:string;url:string};
const bodySchema=z.strictObject({resourceId:AccountId,decision:z.enum(['pay','decline','automatic'])});
const idSchema=z.strictObject({purchaseId:z.uuid()});
const hash=(v:string)=>createHash('sha256').update(v).digest();
/** Bounded private host. Credentials identify a fixed owner; model arguments never choose identity,
 * URLs, amounts, rates, wallet, policy or signing power. The caller supplies durable binding storage. */
export function createPurchaseHost(deps:{
  credentials:ReadonlyMap<string,Principal>;resources:ReadonlyMap<string,PurchaseResource>;
  budget:PurchaseBudgetService;service:X402PurchaseService;
  load:(ownerId:string,id:string)=>PurchaseBinding|undefined;save:(binding:PurchaseBinding)=>void;
  find:(ownerId:string,url:string)=>PurchaseBinding|undefined;
  content:(binding:PurchaseBinding)=>Uint8Array|undefined;
  client?:(resource:PurchaseResource)=>X402MerchantClient;
}) {
 if(!deps.credentials.size)throw new Error('CREDENTIALS_REQUIRED');
 const tokens=[...deps.credentials].map(([token,principal])=>{
  if(token.length<32||!AccountId.safeParse(principal.ownerId).success||!AccountId.safeParse(principal.subjectId).success||
    !['agent','owner'].includes(principal.role))throw new Error('CREDENTIALS_INVALID');
  return {digest:hash(token),principal};
 });
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const token=/^Bearer (\S+)$/.exec(req.headers.authorization??'')?.[1];
  const ctx=token?tokens.find(t=>timingSafeEqual(hash(token),t.digest))?.principal:undefined;
  if(!ctx){send(401,{error:'unauthorized'});return;}
  try{
   const input=await readBody(req);
   if(req.method==='PUT'&&req.url==='/purchases/policy'){
    if(ctx.role!=='owner'){send(403,{error:'owner_required'});return;}
    deps.budget.setPolicy(ctx,PurchaseBudgetPolicy.parse(input));send(200,{status:'updated'});return;
   }
   if(req.method==='POST'&&req.url==='/purchases/budget'){
    const {categoryId}=z.strictObject({categoryId:AccountId}).parse(input);
    send(200,deps.budget.remaining(ctx,categoryId));return;
   }
   if(req.method==='POST'&&req.url==='/purchases'){
    const parsed=bodySchema.parse(input),resource=deps.resources.get(parsed.resourceId);
    if(!resource){send(400,{error:'resource_not_approved'});return;}
    // Stable retries use /reconcile with the returned ID; a new purchase never overrides it.
    const binding=deps.find(ctx.ownerId,resource.url)??await (deps.client?.(resource)??new X402MerchantClient(resource.merchant)).challenge({
     purchaseId:randomUUID(),ownerId:ctx.ownerId,categoryId:resource.categoryId,resourceUrl:resource.url});
    deps.save(binding);
    try{const state=await deps.service.purchase(ctx,binding,parsed.decision);send(200,{purchaseId:binding.purchaseId,...state});}
    catch{send(409,{purchaseId:binding.purchaseId,status:'not_confirmed',next:'/purchases/reconcile'});}
    return;
   }
   if(req.method==='POST'&&['/purchases/reconcile','/purchases/content','/purchases/approve','/purchases/decline'].includes(req.url??'')){
    const {purchaseId}=idSchema.parse(input),binding=deps.load(ctx.ownerId,purchaseId);
    if(!binding){send(404,{error:'not_found'});return;}
    if(req.url==='/purchases/content'){
     const content=deps.content(binding);if(!content){send(409,{error:'content_not_verified'});return;}
     res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(content);return;
    }
    if(req.url==='/purchases/approve'||req.url==='/purchases/decline'){
     if(ctx.role!=='owner'){send(403,{error:'owner_required'});return;}
     send(200,{purchaseId,...await deps.service.purchase(ctx,binding,req.url.endsWith('approve')?'pay':'decline')});return;
    }
    send(200,{purchaseId,...await deps.service.reconcile(ctx,binding)});return;
   }
   send(404,{error:'not_found'});
  }catch{if(!res.headersSent)send(400,{error:'request_refused'});else res.end();}
 });
}
async function readBody(req:IncomingMessage):Promise<unknown>{
 let size=0;const chunks:Buffer[]=[];
 req.setTimeout(10_000,()=>req.destroy());
 for await(const raw of req){const chunk=Buffer.from(raw);size+=chunk.length;if(size>16_384)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
