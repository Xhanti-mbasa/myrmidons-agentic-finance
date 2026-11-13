import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, HarnessPolicy, HarnessTarget, type HarnessAction } from '@shucamoxa/shared';

type Result = Record<string, unknown>;
export type HarnessAdapters = {
  evidence: 'simulated' | 'testnet';
  pay(id: string): Promise<Result>; transferStatus(id: string): Promise<Result>;
  purchase(id: string): Promise<Result>; reconcile(id: string): Promise<Result>; content(id: string): Promise<Result>;
  bridgeQuote(id: string): Promise<Result>;
};
export type AuditEntry = { seq: number; at: string; actor: string; event: string; targetId: string;
  code: string; prevHash: string; hash: string };
const digest = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const genesis = '0'.repeat(64);
export class HarnessError extends Error { constructor(public code: string) { super(code); } }

/** One private installation per owner. The model can only reference owner-registered IDs.
 * All mutation authority remains on the separate owner routes; adapters get no owner token. */
export class Harness {
  private db: DatabaseSync;
  constructor(path: string, readonly adapters: HarnessAdapters, initial: HarnessPolicy, private now = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS harness_policy(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER,body TEXT);
      CREATE TABLE IF NOT EXISTS harness_audit(seq INTEGER PRIMARY KEY,body TEXT);
      CREATE TABLE IF NOT EXISTS harness_flows(id TEXT PRIMARY KEY,body TEXT);
      CREATE TABLE IF NOT EXISTS harness_purchases(id TEXT PRIMARY KEY,target TEXT NOT NULL);`);
    this.atomic(() => {
      if (!this.db.prepare('SELECT id FROM harness_policy').get()) {
        this.db.prepare('INSERT INTO harness_policy VALUES(1,1,?)').run(canonicalJson(HarnessPolicy.parse(initial)));
        this.append('owner', 'installed', '', 'OK');
      }
      this.verify();
    });
  }
  close() { this.db.close(); }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  audit(): AuditEntry[] {
    return this.db.prepare('SELECT body FROM harness_audit ORDER BY seq').all().map(r => JSON.parse(r.body as string));
  }
  verify(): { valid: true; count: number; head: string } {
    let seq = 0, prevHash = genesis;
    for (const entry of this.audit()) {
      const { hash, ...body } = entry;
      if (entry.seq !== ++seq || body.prevHash !== prevHash || digest(body) !== hash) throw new HarnessError('AUDIT_UNAVAILABLE');
      prevHash = hash;
    }
    if (!seq) throw new HarnessError('AUDIT_UNAVAILABLE');
    return { valid: true, count: seq, head: prevHash };
  }
  private append(actor: string, event: string, targetId: string, code: string) {
    const row = this.db.prepare('SELECT seq,body FROM harness_audit ORDER BY seq DESC LIMIT 1').get();
    const previous: AuditEntry | undefined = row ? JSON.parse(row.body as string) : undefined;
    const body = { seq: (previous?.seq ?? 0) + 1, at: this.now().toISOString(), actor, event, targetId, code, prevHash: previous?.hash ?? genesis };
    this.db.prepare('INSERT INTO harness_audit VALUES(?,?)').run(body.seq, canonicalJson({ ...body, hash: digest(body) }));
  }
  policy() {
    const row = this.db.prepare('SELECT version,body FROM harness_policy WHERE id=1').get()!;
    return { version: Number(row.version), policy: HarnessPolicy.parse(JSON.parse(row.body as string)) };
  }
  update(expectedVersion: number, input: unknown) {
    const policy = HarnessPolicy.parse(input);
    return this.atomic(() => {
      this.verify();
      if (this.policy().version !== expectedVersion) throw new HarnessError('POLICY_CHANGED');
      this.db.prepare('UPDATE harness_policy SET version=version+1,body=? WHERE id=1').run(canonicalJson(policy));
      this.append('owner', 'policy_updated', '', 'OK'); return this.policy();
    });
  }
  catalog() {
    const { policy, version } = this.policy();
    return { evidence: this.adapters.evidence, version, enabled: policy.enabled, profile: policy.profile,
      core: ['payment', 'policy', 'compliance', 'audit'], plugins: policy.plugins,
      grants: policy.grants.map(({ action, targetId, label, category }) => ({ action, targetId, label, category })),
      flows: policy.flows.map(({ id, label }) => ({ id, label })),
      compliance: 'Owner-supplied eligibility evidence; no legal or regulatory certification.' };
  }
  private assess(target: HarnessTarget) {
    const { policy, version } = this.policy();
    const grant = policy.grants.find(g => g.action === target.action && g.targetId === target.targetId);
    let code = 'OK';
    if (!policy.enabled) code = 'KILL_SWITCH_ON';
    else if (target.action === 'bridge' && !policy.plugins.bridge) code = 'PLUGIN_DISABLED';
    else if (!grant) code = 'TARGET_NOT_APPROVED';
    else if (!grant.eligible) code = 'ELIGIBILITY_DENIED';
    else if (Date.parse(grant.expiresAt) <= this.now().getTime()) code = 'ELIGIBILITY_EXPIRED';
    else if (!policy.allowedCategories.includes(grant.category)) code = 'CATEGORY_DENIED';
    return { allowed: code === 'OK', code, version, evidenceRef: grant?.evidenceRef,
      executionRequiresBackendRecheck: true };
  }
  check(input: unknown) {
    const target = HarnessTarget.parse(input);
    return this.atomic(() => { this.verify(); const result = this.assess(target);
      this.append('tool', 'policy_checked', target.targetId, result.code); return result; });
  }
  private gate(target: HarnessTarget) {
    return this.atomic(() => {
      this.verify(); const decision = this.assess(target);
      this.append('tool', decision.allowed ? 'execution_requested' : 'execution_blocked', target.targetId, decision.code);
      return decision;
    });
  }
  async execute(action: HarnessAction, targetId: string) {
    const target = HarnessTarget.parse({ action, targetId });
    const decision = this.gate(target);
    if (!decision.allowed) return { status: 'blocked', ...decision, evidence: this.adapters.evidence };
    try {
      // There is no intervening await between the local check and invoking the adapter.
      // The isolated payment backend MUST recheck current budgets, mandate and signing authority.
      const result = await (action === 'pay' ? this.adapters.pay(targetId) : action === 'purchase' ? this.adapters.purchase(targetId) : this.adapters.bridgeQuote(targetId));
      this.atomic(() => {
        this.verify();
        if (action === 'purchase' && typeof result.purchaseId === 'string') {
          // A receipt can never change the resource binding of a previously known purchase.
          const prior = this.db.prepare('SELECT target FROM harness_purchases WHERE id=?').get(result.purchaseId);
          if (prior && prior.target !== targetId) throw new HarnessError('PURCHASE_BINDING_MISMATCH');
          this.db.prepare('INSERT INTO harness_purchases VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(result.purchaseId, targetId);
        }
        this.append('tool', 'execution_returned', targetId, String(result.code ?? result.status ?? 'UNKNOWN').slice(0, 64));
      });
      return { evidence: this.adapters.evidence, result };
    } catch {
      // The backend may already have signed: no new target, ID or automatic retry is invented here.
      this.atomic(() => { this.verify(); this.append('tool', 'outcome_unknown', targetId, 'RECONCILE_REQUIRED'); });
      return { evidence: this.adapters.evidence, status: 'unknown', code: 'RECONCILE_REQUIRED', targetId };
    }
  }
  async read(kind: 'transfer' | 'reconcile' | 'content', id: string) {
    this.verify();
    if (kind === 'transfer') {
      if (!this.policy().policy.grants.some(g => g.action === 'pay' && g.targetId === id)) throw new HarnessError('TARGET_NOT_APPROVED');
    } else if (!this.db.prepare('SELECT id FROM harness_purchases WHERE id=?').get(id)) throw new HarnessError('TARGET_NOT_APPROVED');
    // Reads/reconciliation remain possible after a kill switch or eligibility expiry; they cannot sign.
    const result = await (kind === 'transfer' ? this.adapters.transferStatus(id) : kind === 'reconcile' ? this.adapters.reconcile(id) : this.adapters.content(id));
    this.atomic(() => { this.verify(); this.append('tool', 'evidence_read', id, 'OK'); });
    return { evidence: this.adapters.evidence, result };
  }
  async flow(id: string) {
    const claim = this.atomic(() => {
      this.verify(); const { policy } = this.policy();
      if (!policy.enabled || !policy.plugins.automation) throw new HarnessError('AUTOMATION_DISABLED');
      const row = this.db.prepare('SELECT body FROM harness_flows WHERE id=?').get(id);
      if (row) return { previous: JSON.parse(row.body as string) as Result };
      const flow = policy.flows.find(f => f.id === id);
      if (!flow) throw new HarnessError('FLOW_NOT_APPROVED');
      const run = { runId: randomUUID(), flowId: id, status: 'running', steps: [] as Result[] };
      this.db.prepare('INSERT INTO harness_flows VALUES(?,?)').run(id, canonicalJson(run));
      this.append('tool', 'flow_claimed', id, 'OK'); return { run, flow };
    });
    if (claim.previous) return { evidence: this.adapters.evidence, ...claim.previous, repeated: true, instruction: 'A running flow may have an unknown outcome. Inspect its registered targets; do not create another flow to retry.' };
    const { run, flow } = claim;
    for (const step of flow!.steps) {
      const { policy } = this.policy();
      if (!policy.enabled || !policy.plugins.automation) { run!.status = 'blocked'; break; }
      const result = await this.execute(step.action, step.targetId);
      run!.steps.push({ ...step, ...result });
      const backendStatus = (result as { result?: Result }).result?.status;
      if ('status' in result || !['settled', 'delivered', 'quoted'].includes(String(backendStatus))) run!.status = 'stopped';
      this.atomic(() => { this.verify(); this.db.prepare('UPDATE harness_flows SET body=? WHERE id=?').run(canonicalJson(run), id); });
      if (run!.status !== 'running') break;
    }
    if (run!.status === 'running') run!.status = 'completed';
    this.atomic(() => { this.verify(); this.db.prepare('UPDATE harness_flows SET body=? WHERE id=?').run(canonicalJson(run), id);
      this.append('tool', 'flow_finished', id, run!.status.toUpperCase()); });
    return { evidence: this.adapters.evidence, ...run };
  }
}
