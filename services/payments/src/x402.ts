import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { X402Challenge } from '../../../packages/shared/src/x402';
import { canonicalJson } from '../../../packages/shared/src/log';
import type { Principal } from './payment';

export type Merchant = Readonly<{ id: string; origin: string; payTo: string; destinationTag?: number;
  facilitator: 'https://x402.org/facilitator' | 'https://xrpl-facilitator-testnet.t54.ai'; termsUrl: string }>;
export type PurchaseBinding = Readonly<{ purchaseId: string; ownerId: string; merchantId: string;
  categoryId: string; resourceUrl: string; resourceHash: string; challenge: X402Challenge;
  expiresAt: string; digest: string }>;
export type PurchaseOutcome = 'unknown' | 'settled' | 'rejected';
export type PurchaseState = { status: 'declined' | 'awaiting_owner' | 'unknown' | 'settled' | 'delivered' | 'delivery_failed' | 'blocked'; digest: string };
/** Trusted backend adapters, never model tools. No default or key-holding implementation. */
export type X402Adapters = {
  budget: {
    reserve(ctx: Principal, binding: PurchaseBinding): { budgetDigest: string };
    /** Recheck policy/version/revocation immediately before signing. */
    authorize(ctx: Principal, binding: PurchaseBinding): { budgetDigest: string };
    reconcile(ctx: Principal, binding: PurchaseBinding, evidence: unknown): PurchaseOutcome;
    status(ctx: Principal, binding: PurchaseBinding): 'none' | 'reserved' | 'unknown' | 'settled' | 'rejected';
  };
  execution: {
    /** Mandatory independent signer: binds exact challenge, payer, fee cap, expiry and budgetDigest;
     * merchant sends PAYMENT-SIGNATURE to its pinned facilitator. Persists tx identity before I/O.
     * Must not sign a second tx on an uncertain outcome. Return evidence, never mere submit success. */
    execute(binding: PurchaseBinding, budgetDigest: string): Promise<unknown>;
    lookup(binding: PurchaseBinding): Promise<unknown>;
    /** Fetch cached purchased content without another payment; enforce same URL/origin, no redirects. */
    deliver(binding: PurchaseBinding): Promise<boolean>;
  };
};
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Header decoding only, not permission to pay. Strict bounded profile intentionally rejects extensions. */
export function decodePaymentRequired(header: string): X402Challenge {
  if (header.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw new Error('CHALLENGE_INVALID');
  try { return X402Challenge.parse(JSON.parse(Buffer.from(header, 'base64').toString('utf8'))); }
  catch { throw new Error('CHALLENGE_INVALID'); }
}
export function bindPurchase(input: { purchaseId: string; ownerId: string; categoryId: string;
  requestedUrl: string; challenge: unknown; merchant: Merchant; receivedAt: Date }): PurchaseBinding {
  const challenge = X402Challenge.parse(input.challenge), requirement = challenge.accepts[0]!;
  const url = new URL(input.requestedUrl), configured = new URL(input.merchant.origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || configured.origin !== input.merchant.origin ||
      url.origin !== configured.origin || requirement.payTo !== input.merchant.payTo ||
      requirement.extra.destinationTag !== input.merchant.destinationTag ||
      !['https://x402.org/facilitator','https://xrpl-facilitator-testnet.t54.ai'].includes(input.merchant.facilitator)) throw new Error('MERCHANT_MISMATCH');
  if (challenge.resource.url !== url.href) throw new Error('RESOURCE_MISMATCH');
  if (!/^[0-9a-f-]{36}$/i.test(input.purchaseId) || !input.ownerId || !input.categoryId ||
      !Number.isFinite(input.receivedAt.getTime())) throw new Error('CHALLENGE_INVALID');
  const data = { purchaseId: input.purchaseId, ownerId: input.ownerId, categoryId: input.categoryId,
    merchantId: input.merchant.id, resourceUrl: url.href, resourceHash: digest({ method: 'GET', url: url.href }),
    challenge, expiresAt: new Date(input.receivedAt.getTime() + requirement.maxTimeoutSeconds * 1000).toISOString() };
  return { ...data, digest: digest(data) };
}

/** Private durable single-attempt coordinator. Crashes and transport failures remain unknown. */
export class X402PurchaseService {
  private db: DatabaseSync;
  constructor(path: string, private adapters: X402Adapters, private now = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS purchases(owner TEXT,id TEXT,resource TEXT,binding TEXT,state TEXT,PRIMARY KEY(owner,id),UNIQUE(owner,resource));');
  }
  close() { this.db.close(); }
  private check(ctx: Principal, binding: PurchaseBinding) {
    const { digest: expected, ...data } = binding;
    if (!ctx || !['agent','owner'].includes(ctx.role) || ctx.ownerId !== binding.ownerId || digest(data) !== expected)
      throw new Error('PURCHASE_MISMATCH');
  }
  private state(ctx: Principal, binding: PurchaseBinding): PurchaseState | undefined {
    const row = this.db.prepare('SELECT binding,state FROM purchases WHERE owner=? AND id=?').get(ctx.ownerId,binding.purchaseId);
    if (!row) return undefined;
    if (row.binding !== canonicalJson(binding)) throw new Error('PURCHASE_MISMATCH');
    return JSON.parse(row.state as string);
  }
  private save(binding: PurchaseBinding, status: PurchaseState['status']): PurchaseState {
    const state = { status, digest: binding.digest };
    this.db.prepare(`INSERT INTO purchases VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET state=excluded.state WHERE json_extract(purchases.state, '$.status') = 'awaiting_owner' OR (json_extract(purchases.state, '$.status') = 'unknown' AND json_extract(excluded.state, '$.status') IN ('unknown','settled','blocked')) OR (json_extract(purchases.state, '$.status') IN ('settled','delivery_failed') AND json_extract(excluded.state, '$.status') IN ('delivered','delivery_failed'))`)
      .run(binding.ownerId,binding.purchaseId,binding.resourceHash,canonicalJson(binding),canonicalJson(state));
    return this.state({ ownerId: binding.ownerId, subjectId: 'backend', role: 'owner' },binding)!;
  }
  async purchase(ctx: Principal, binding: PurchaseBinding, decision: 'pay'|'decline'|'automatic'): Promise<PurchaseState> {
    this.check(ctx,binding);
    if (!['pay','decline','automatic'].includes(decision)) throw new Error('CHALLENGE_INVALID');
    // Persist the binding BEFORE the independently committed budget reservation.
    // A crash can then always be reconciled by purchase ID, including after reserve/authorize.
    this.db.exec('BEGIN IMMEDIATE');
    let authorization: { budgetDigest: string };
    try {
      const duplicate = this.db.prepare('SELECT id FROM purchases WHERE owner=? AND resource=?').get(ctx.ownerId,binding.resourceHash);
      if (duplicate && duplicate.id !== binding.purchaseId) throw new Error('PURCHASE_MISMATCH');
      const old = this.state(ctx,binding);
      if (old && old.status !== 'awaiting_owner') { this.db.exec('COMMIT'); return old; }
      if (this.adapters.budget.status(ctx,binding) !== 'none') {
        const s=this.save(binding,'unknown'); this.db.exec('COMMIT'); return s;
      }
      if (decision === 'decline') { const s=this.save(binding,'declined'); this.db.exec('COMMIT'); return s; }
      if (decision === 'pay' && ctx.role !== 'owner') { const s=this.save(binding,'awaiting_owner'); this.db.exec('COMMIT'); return s; }
      if (Date.parse(binding.expiresAt) <= this.now().getTime()) throw new Error('CHALLENGE_EXPIRED');
      this.save(binding,'awaiting_owner');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    // Claim single-attempt execution durably before calling any independently committed adapter.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.state(ctx,binding)!;
      if (current.status !== 'awaiting_owner') { this.db.exec('COMMIT'); return current; }
      this.save(binding,'unknown'); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    try {
      this.adapters.budget.reserve(ctx,binding);
      authorization = this.adapters.budget.authorize(ctx,binding);
    } catch (error) {
      // No retry or speculative release: the independent adapter may have committed.
      throw error;
    }
    try {
      const evidence = await this.adapters.execution.execute(binding,authorization.budgetDigest);
      return await this.finish(ctx,binding,evidence);
    } catch { return this.state(ctx,binding)!; }
  }
  async reconcile(ctx: Principal, binding: PurchaseBinding): Promise<PurchaseState> {
    this.check(ctx,binding); let state=this.state(ctx,binding);
    if (!state) throw new Error('PURCHASE_MISMATCH');
    // A reserve operation in another process may finish after no-sign recovery closed this ID.
    // Reconcile that late reservation without ever reopening the terminal purchase.
    if (state.status==='blocked' && ['reserved','unknown'].includes(this.adapters.budget.status(ctx,binding))) {
      this.adapters.budget.reconcile(ctx,binding,await this.adapters.execution.lookup(binding)); return state;
    }
    if (state.status==='awaiting_owner' && this.adapters.budget.status(ctx,binding)!=='none') state=this.save(binding,'unknown');
    if (state.status === 'unknown') return this.finish(ctx,binding,await this.adapters.execution.lookup(binding));
    if (state.status === 'delivery_failed' || state.status === 'settled') return this.deliver(binding);
    return state;
  }
  private async finish(ctx: Principal,binding: PurchaseBinding,evidence: unknown): Promise<PurchaseState> {
    const outcome=this.adapters.budget.reconcile(ctx,binding,evidence);
    if (outcome === 'unknown') return this.save(binding,'unknown');
    if (outcome === 'rejected') return this.save(binding,'blocked');
    const state=this.save(binding,'settled');
    if (state.status !== 'settled' && state.status !== 'delivery_failed') return state;
    return this.deliver(binding);
  }
  private async deliver(binding: PurchaseBinding): Promise<PurchaseState> {
    try { return this.save(binding, await this.adapters.execution.deliver(binding) ? 'delivered':'delivery_failed'); }
    catch { return this.save(binding,'delivery_failed'); }
  }
}
