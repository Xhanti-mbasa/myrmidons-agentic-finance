import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Wallet, verifySignature, hashes, type Payment } from 'xrpl';
import { canonicalJson, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS,
  toMicros, type PurchaseReservation } from '@shucamoxa/shared';
import { type PurchaseBinding, type X402Adapters } from '../../payments/src/x402';
import { X402MerchantClient } from '../../payments/src/x402-merchant';

type Prepared = { sequence: number; ledger: number };
export interface PurchaseLedger {
  readonly network: typeof XRPL_TESTNET_WSS;
  prepare(address: string): Promise<Prepared>;
  lookup(hash: string): Promise<unknown>;
}
/** The only bundled live ledger connection. No caller-supplied RPC/network is accepted. */
export class TestnetPurchaseLedger implements PurchaseLedger {
  readonly network = XRPL_TESTNET_WSS;
  private connected=false;
  private async rpc(method:string,params:Record<string,unknown>={}):Promise<any>{
    const response=await fetch('https://s.altnet.rippletest.net:51234/',{method:'POST',redirect:'manual',
      headers:{'content-type':'application/json'},body:JSON.stringify({method,params:[params]}),signal:AbortSignal.timeout(15_000)});
    if(response.status!==200||!response.body)throw new Error('LEDGER_UNAVAILABLE');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;
      if(total>512_000){await reader.cancel();throw new Error('LEDGER_RESPONSE_TOO_LARGE');}chunks.push(value);}}
    finally{reader.releaseLock();}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8')).result;
    if(!result||result.error||result.status==='error')throw new Error('LEDGER_UNAVAILABLE');return result;
  }
  async connect() {
    const result=await this.rpc('server_info');
    if(result.info?.network_id!==1||result.info?.server_state!=='full')throw new Error('TESTNET_UNAVAILABLE');
    this.connected=true;
  }
  async close() {this.connected=false;}
  private ready(){if(!this.connected)throw new Error('LEDGER_NOT_CONNECTED');}
  async prepare(address: string): Promise<Prepared> {
    this.ready();const account=await this.rpc('account_info',{account:address,ledger_index:'validated'});
    const issuer=await this.rpc('account_info',{account:RLUSD_TESTNET_ISSUER,ledger_index:'validated'});
    if((issuer.account_data.TransferRate??1_000_000_000)!==1_000_000_000)throw new Error('ISSUER_TRANSFER_FEE_UNSUPPORTED');
    const ledger=await this.rpc('ledger',{ledger_index:'validated'});
    return {sequence:account.account_data.Sequence,ledger:ledger.ledger_index};
  }
  async lookup(hash: string): Promise<unknown> {
    this.ready();return this.rpc('tx',{transaction:hash,binary:false});
  }
  async broadcast(blob:string):Promise<void> {this.ready();await this.rpc('submit',{tx_blob:blob});}
}
const sha = (value:string) => createHash('sha256').update(value).digest('hex').toUpperCase();
type Journal = { binding: PurchaseBinding; budgetDigest: string; tx: Payment; blob: string; hash: string;
  outcome: 'unknown'|'settled'|'rejected'; content?: string };
export type PurchaseSigningGate = <T>(binding: PurchaseBinding,budgetDigest:string,
  sign:(reservation:Readonly<PurchaseReservation>)=>T)=>T;

/** Private policy/wallet host only. No methods expose raw signing or private keys to the model.
 * This adapter consumes a dedicated purchase-wallet mandate, never the invoice treasury mandate. */
type ExecutionAdapter = X402Adapters['execution'];
export class TestnetPurchaseExecutor implements ExecutionAdapter {
  private db: DatabaseSync;
  constructor(path:string, private wallet:Wallet, private ledger:PurchaseLedger,
    private gate:PurchaseSigningGate, private merchant:(binding:PurchaseBinding)=>X402MerchantClient,
    private maxFeeDrops:string, private minimumFeeRlusd:string, private now=()=>new Date()) {
    if (ledger.network !== XRPL_TESTNET_WSS || !/^[1-9]\d{0,3}$/.test(maxFeeDrops) ||
      BigInt(maxFeeDrops)>1000n || toMicros(minimumFeeRlusd)<=0n) throw new Error('UNSAFE_SIGNER_CONFIG');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS signed_purchases(owner TEXT,id TEXT,body TEXT,PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS closed_purchases(owner TEXT,id TEXT,digest TEXT,PRIMARY KEY(owner,id));`);
  }
  close() { this.db.close(); }
  private get(b:PurchaseBinding):Journal|undefined {
    const row=this.db.prepare('SELECT body FROM signed_purchases WHERE owner=? AND id=?').get(b.ownerId,b.purchaseId);
    if (!row) return undefined;
    const record=JSON.parse(row.body as string) as Journal;
    if (canonicalJson(record.binding)!==canonicalJson(b)) throw new Error('PURCHASE_MISMATCH');
    return record;
  }
  private put(record:Journal) {
    this.db.prepare(`INSERT INTO signed_purchases VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body
      WHERE json_extract(signed_purchases.body,'$.outcome')='unknown'
      OR json_extract(signed_purchases.body,'$.outcome')=json_extract(excluded.body,'$.outcome')`)
      .run(record.binding.ownerId,record.binding.purchaseId,canonicalJson(record));
  }
  async execute(binding:PurchaseBinding,budgetDigest:string):Promise<unknown> {
    binding=structuredClone(binding);
    this.merchant(binding).validate(binding);
    // Duplicate execute is lookup only: never create or broadcast a second transaction.
    if (this.get(binding)) return this.lookup(binding);
    const prepared=await this.ledger.prepare(this.wallet.address);
    if (!Number.isSafeInteger(prepared.sequence)||prepared.sequence<1 ||
      !Number.isSafeInteger(prepared.ledger)||prepared.ledger<1) throw new Error('LEDGER_UNAVAILABLE');
    const req=binding.challenge.accepts[0]!;
    const tx:Payment={TransactionType:'Payment',Account:this.wallet.address,Destination:req.payTo,
      Amount:{currency:RLUSD_CURRENCY_HEX,issuer:RLUSD_TESTNET_ISSUER,value:req.amount},
      Fee:this.maxFeeDrops,Sequence:prepared.sequence,LastLedgerSequence:prepared.ledger+4,
      SourceTag:req.extra.sourceTag ?? 804681468,InvoiceID:sha(req.extra.invoiceId),
      Memos:[{Memo:{MemoType:Buffer.from('shucamoxa/purchase').toString('hex').toUpperCase(),
        MemoData:Buffer.from(binding.digest+':'+budgetDigest).toString('hex').toUpperCase()}}],
      ...(req.extra.destinationTag!==undefined?{DestinationTag:req.extra.destinationTag}:{})};
    let record:Journal|undefined, created=false;
    // Lock journal first, then final policy validation + synchronous signing. No await inside either lock.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      record=this.get(binding);
      if (!record) {
        if (this.db.prepare('SELECT id FROM closed_purchases WHERE owner=? AND id=?').get(binding.ownerId,binding.purchaseId))
          throw new Error('PURCHASE_CLOSED');
        // A source has at most one unresolved sequence transaction, across processes and owners.
        const pending=this.db.prepare('SELECT body FROM signed_purchases').all()
          .map(row=>JSON.parse(row.body as string) as Journal)
          .some(row=>row.tx.Account===this.wallet.address && row.outcome==='unknown');
        if (pending) throw new Error('PAYER_BUSY');
        record=this.gate(binding,budgetDigest,reservation=>{
          const {digest,...data}=binding;
          if (createHash('sha256').update(canonicalJson(data)).digest('hex')!==digest ||
            Date.parse(binding.expiresAt)-this.now().getTime()<20_000 ||
            reservation.ownerId!==binding.ownerId || reservation.purchaseId!==binding.purchaseId ||
            reservation.categoryId!==binding.categoryId || reservation.merchantId!==binding.merchantId ||
            reservation.resourceHash!==binding.resourceHash || reservation.budgetDigest!==budgetDigest ||
            toMicros(reservation.amountRlusd)!==toMicros(req.amount) ||
            toMicros(reservation.feeRlusd)<toMicros(this.minimumFeeRlusd) ||
            req.network!=='xrpl:1' || req.asset!==RLUSD_CURRENCY_HEX || req.extra.issuer!==RLUSD_TESTNET_ISSUER)
            throw new Error('PURCHASE_MISMATCH');
          const signed=this.wallet.sign(tx);
          if (!verifySignature(signed.tx_blob)) throw new Error('SIGNATURE_INVALID');
          return {binding,budgetDigest,tx,blob:signed.tx_blob,hash:signed.hash,outcome:'unknown' as const};
        });
        this.put(record);
        created=true;
      }
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    if (!created) return this.lookup(binding);
    // Signature identity is durable before the merchant/facilitator can receive it.
    try {
      const bytes=await this.merchant(binding).deliver(binding,this.payload(record));
      record.content=Buffer.from(bytes).toString('base64');this.put(record);
    } catch { /* Delivery and settlement are independent. Query exact hash even after timeout. */ }
    return this.lookup(binding);
  }
  private payload(record:Journal):string {
    return Buffer.from(canonicalJson({x402Version:2,accepted:record.binding.challenge.accepts[0],
      payload:{signedTxBlob:record.blob}})).toString('base64');
  }
  async lookup(binding:PurchaseBinding):Promise<unknown> {
    const record=this.get(binding);
    if (!record) {
      // Durable no-sign tombstone closes the crash-before-sign window. A concurrent execute
      // must take this same journal lock and therefore cannot sign after this proof.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (!this.get(binding)) this.db.prepare('INSERT INTO closed_purchases VALUES(?,?,?) ON CONFLICT DO NOTHING')
          .run(binding.ownerId,binding.purchaseId,binding.digest);
        this.db.exec('COMMIT');
      } catch(error) {this.db.exec('ROLLBACK');throw error;}
      return {purchaseId:binding.purchaseId};
    }
    if (record.outcome==='unknown') {
      try {
        const result=await this.ledger.lookup(record.hash);
        const outcome=verifiedPurchaseOutcome(result,record.tx,record.hash);
        if (outcome!=='unknown') {record.outcome=outcome;this.put(record);}
      } catch { /* Absence/timeouts never prove non-payment. */ }
    }
    return {purchaseId:binding.purchaseId};
  }
  verifyOutcome(reservation:Readonly<PurchaseReservation>,_evidence:unknown):'settled'|'rejected'|'unknown' {
    const row=this.db.prepare('SELECT body FROM signed_purchases WHERE owner=? AND id=?').get(reservation.ownerId,reservation.purchaseId);
    if (row) {
      const record=JSON.parse(row.body as string) as Journal;
      return record.budgetDigest===reservation.budgetDigest && record.binding.resourceHash===reservation.resourceHash
        ? record.outcome:'unknown';
    }
    const closed=this.db.prepare('SELECT id FROM closed_purchases WHERE owner=? AND id=?').get(reservation.ownerId,reservation.purchaseId);
    return closed?'rejected':'unknown';
  }
  verifyAbsent(ownerId:string,purchaseId:string):boolean {
    return !!this.db.prepare('SELECT id FROM closed_purchases WHERE owner=? AND id=?').get(ownerId,purchaseId);
  }
  rejectedFeeRlusd(reservation:Readonly<PurchaseReservation>):string {
    const row=this.db.prepare('SELECT body FROM signed_purchases WHERE owner=? AND id=?').get(reservation.ownerId,reservation.purchaseId);
    // A signed transaction with a validated rejection consumed the payer's XRP fee.
    return row ? reservation.feeRlusd:'0';
  }
  async deliver(binding:PurchaseBinding):Promise<boolean> {
    const record=this.get(binding);
    if (!record || record.outcome!=='settled') return false;
    if (!record.content) {
      try {record.content=Buffer.from(await this.merchant(binding).deliver(binding,this.payload(record))).toString('base64');this.put(record);}
      catch {return false;}
    }
    return true;
  }
  /** Authenticated host only: never return content or signatures until settlement is verified. */
  content(binding:PurchaseBinding):Uint8Array|undefined {
    const r=this.get(binding);return r?.outcome==='settled'&&r.content ? Buffer.from(r.content,'base64'):undefined;
  }
}

/** Verify signed transaction identity AND actual delivered amount from a fixed trusted ledger. */
export function verifiedPurchaseOutcome(raw:unknown,expected:Payment,hash:string):'settled'|'rejected'|'unknown' {
  try {
    const r=raw as any, tx=r.tx_json, meta=r.meta;
    if (r.validated!==true || r.hash!==hash || !Number.isSafeInteger(r.ledger_index)||r.ledger_index<=0 || !tx || !meta)
      return 'unknown';
    const allowed=new Set([...Object.keys(expected),'SigningPubKey','TxnSignature','hash','date','ledger_index','inLedger','ctid','DeliverMax']);
    if (Object.keys(tx).some(key=>!allowed.has(key))) return 'unknown';
    const normal={...tx};if(normal.DeliverMax!==undefined){normal.Amount=normal.DeliverMax;delete normal.DeliverMax;}
    for (const [key,value] of Object.entries(expected)) {
      if (key==='Amount') {
        const amount=expected.Amount;
        if (!normal.Amount || typeof normal.Amount==='string' || typeof amount==='string' || !('currency' in amount) ||
          normal.Amount.currency!==amount.currency || normal.Amount.issuer!==amount.issuer ||
          toMicros(normal.Amount.value)!==toMicros(amount.value)) return 'unknown';
      } else if (canonicalJson(normal[key])!==canonicalJson(value)) return 'unknown';
    }
    const signedTx={...normal};for(const k of ['hash','date','ledger_index','inLedger','ctid'])delete signedTx[k];
    if (!verifySignature(signedTx) || hashes.hashSignedTx(signedTx)!==hash) return 'unknown';
    if (/^tec[A-Za-z0-9_]+$/.test(meta.TransactionResult)) return 'rejected';
    const delivered=meta.delivered_amount, amount=expected.Amount;
    if (meta.TransactionResult!=='tesSUCCESS'||typeof amount==='string'||!('currency' in amount)||!delivered||typeof delivered==='string'||
      delivered.currency!==amount.currency||delivered.issuer!==amount.issuer||
      toMicros(delivered.value)!==toMicros(amount.value)) return 'unknown';
    return 'settled';
  } catch {return 'unknown';}
}
