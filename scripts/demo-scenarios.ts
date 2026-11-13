/** Fresh isolated SIMULATION using actual HTTP authorization and durable demo coordinators.
 * Never contacts Ollama, an XRPL node, a faucet, merchant or the operator's running demo. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDemo } from '../services/backend/src/harness/demo';
import { Harness } from '../services/backend/src/harness/core';
import { createHarnessServer } from '../services/backend/src/harness/http';

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'shucamoxa-scenarios-'));
  const demo = createDemo(directory);
  const h = new Harness(join(directory, 'harness.db'), demo.adapters, demo.initial);
  const credentials = { owner: randomBytes(32).toString('base64url'), agent: randomBytes(32).toString('base64url') };
  const server = createHarnessServer(h, credentials);
  let completed = 0;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    async function request(path: string, body?: unknown, role: 'agent' | 'owner' = 'agent', method = 'POST', expected = 200) {
      const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + credentials[role], 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.status, expected, 'HTTP boundary: ' + path);
      return await response.json() as any;
    }
    const tool = (name: string, body: unknown = {}) => request('/tools/' + name, body);
    const pass = (label: string) => { completed++; console.log('PASS ' + label + ' [simulated, local HTTP]'); };
    async function update(change: (policy: any) => any) {
      const current = await request('/owner/state', undefined, 'owner', 'GET');
      return request('/owner/policy', { expectedVersion: current.version, policy: change(current.policy) }, 'owner', 'PUT');
    }
    const catalog = await tool('get_capabilities');
    assert.equal(catalog.evidence, 'simulated'); assert.equal(catalog.core.length, 4);
    pass('capability discovery: four core capabilities, two optional plugins');
    const [allowed, over, expired] = catalog.grants.filter((g: any) => g.action === 'pay');
    const first = await tool('pay', { intentId: allowed.targetId });
    assert.equal(first.evidence, 'simulated'); assert.equal(first.result.status, 'settled');
    pass('allowed 30.00 RLUSD fixture settles in simulation');
    const repeats = await Promise.all(Array.from({ length: 5 }, () => tool('pay', { intentId: allowed.targetId })));
    assert.ok(repeats.every(r => r.result.txHash === first.result.txHash));
    pass('five concurrent duplicate calls recover the same transaction identity');
    assert.equal((await tool('get_transfer_status', { intentId: allowed.targetId })).result.status, 'settled');
    pass('status lookup returns the stored outcome');
    assert.equal((await tool('pay', { intentId: over.targetId })).result.code, 'OVER_PER_PAYMENT_CAP');
    pass('75.00 fixture blocked by the real coordinator cap of 50.00');
    assert.equal((await tool('pay', { intentId: expired.targetId })).code, 'ELIGIBILITY_EXPIRED');
    pass('expired owner eligibility blocks before payment');
    await request('/tools/pay', { intentId: allowed.targetId, amount: '49.00', owner: true }, 'agent', 'POST', 400);
    await request('/owner/state', undefined, 'agent', 'GET', 403);
    pass('amount/authority injection and agent access to owner routes refused');
    await update(policy => ({ ...policy, enabled: false }));
    assert.equal((await tool('pay', { intentId: allowed.targetId })).code, 'KILL_SWITCH_ON');
    await update(policy => ({ ...policy, enabled: true }));
    pass('owner pause blocks new dispatch; owner resumes explicitly');
    await update(policy => ({ ...policy, plugins: { ...policy.plugins, bridge: false } }));
    assert.equal((await tool('bridge_quote', { routeId: 'xrpl_to_evm' })).code, 'PLUGIN_DISABLED');
    await update(policy => ({ ...policy, plugins: { ...policy.plugins, bridge: true } }));
    const quote = await tool('bridge_quote', { routeId: 'xrpl_to_evm' });
    assert.equal(quote.result.simulated, true); assert.equal(quote.result.executionEnabled, false);
    pass('bridge toggle enforced even on cached calls; enabled quote never executes a bridge');
    const flow = await tool('run_flow', { flowId: 'university_research' });
    assert.equal(flow.status, 'completed');
    const again = await tool('run_flow', { flowId: 'university_research' });
    assert.equal(again.runId, flow.runId); assert.equal(again.repeated, true);
    const purchaseId = flow.steps[0].result.purchaseId;
    assert.equal((await tool('reconcile_purchase', { purchaseId })).result.status, 'delivered');
    assert.match((await tool('read_purchased_resource', { purchaseId })).result.untrusted_content, /SIMULATED RESEARCH ARTICLE/);
    pass('research workflow, repeat recovery, reconciliation and gated sample content');
    await update(policy => ({ ...policy, plugins: { ...policy.plugins, automation: false } }));
    await request('/tools/run_flow', { flowId: 'supplier_payment' }, 'agent', 'POST', 409);
    pass('disabled automation cannot execute a cached workflow');
    const audit = await tool('get_audit_log');
    assert.equal(audit.valid, true); assert.ok(audit.count > 10);
    pass('audit chain verifies after all scenarios (external checkpoint still required)');
    console.log('\n' + completed + ' scenarios passed. SIMULATION only; zero blockchain funds moved.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    h.close(); demo.close(); rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('Scenario check failed. No credentials or private responses logged. Run pnpm test:demo for detailed isolated assertions.'); process.exitCode = 1; });
