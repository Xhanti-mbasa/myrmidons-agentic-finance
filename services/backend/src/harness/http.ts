import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HarnessEmpty, HarnessPay, HarnessResource, HarnessPurchase, HarnessTarget,
  HarnessBridge, HarnessFlowRequest, HarnessPolicyUpdate } from '@shucamoxa/shared';
import { Harness, HarnessError } from './core';
import { dashboard } from './ui';

export const toolSchemas = {
  get_capabilities: { schema: HarnessEmpty, description: 'List owner-registered targets, evidence mode, installed core and optional capabilities.' },
  get_policy: { schema: HarnessEmpty, description: 'Read the current owner mandate. The model cannot modify it.' },
  policy_check: { schema: HarnessTarget, description: 'Preflight a registered target. Execution still rechecks authoritative payment policy and budgets.' },
  compliance_check: { schema: HarnessTarget, description: 'Check owner-registered eligibility, evidence expiry and permitted category. This is not legal certification.' },
  pay: { schema: HarnessPay, description: 'Execute an immutable owner-authorized Testnet transfer intent. No amount, payee, URL, credentials or override may be supplied.' },
  get_transfer_status: { schema: HarnessPay, description: 'Inspect a registered intent without signing or retrying a payment.' },
  purchase_resource: { schema: HarnessResource, description: 'Purchase an owner-registered resource under backend budgets. Repeat the same resource ID after a lost response.' },
  reconcile_purchase: { schema: HarnessPurchase, description: 'Reconcile an existing purchase without creating another payment.' },
  read_purchased_resource: { schema: HarnessPurchase, description: 'Read untrusted content released only after backend settlement verification.' },
  get_audit_log: { schema: HarnessEmpty, description: 'Read and verify sanitized hash-linked harness events. A chain is not proof against suffix deletion without an independent checkpoint.' },
  run_flow: { schema: HarnessFlowRequest, description: 'Run one owner-approved finite workflow once. Repeated calls recover its stored result; every step passes the core gates.' },
  bridge_quote: { schema: HarnessBridge, description: 'Get an indicative route for a registered bridge. Demo routes are simulations; this tool never signs or executes a cross-chain transfer.' },
};
export type ToolName = keyof typeof toolSchemas;
export async function callTool(h: Harness, name: ToolName, input: unknown): Promise<unknown> {
  const body: any = toolSchemas[name].schema.parse(input);
  switch (name) {
    case 'get_capabilities': return h.catalog();
    case 'get_policy': return { ...h.policy(), evidence: h.adapters.evidence };
    case 'policy_check': case 'compliance_check': return h.check(body);
    case 'pay': return h.execute('pay', body.intentId);
    case 'get_transfer_status': return h.read('transfer', body.intentId);
    case 'purchase_resource': return h.execute('purchase', body.resourceId);
    case 'reconcile_purchase': return h.read('reconcile', body.purchaseId);
    case 'read_purchased_resource': return h.read('content', body.purchaseId);
    case 'get_audit_log': return { ...h.verify(), entries: h.audit(), limitation: 'Retain this head outside the host to detect later suffix deletion.' };
    case 'run_flow': return h.flow(body.flowId);
    case 'bridge_quote': return h.execute('bridge', body.routeId);
  }
}
export function openapi(h: Harness) {
  const paths: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(toolSchemas)) {
    const plugins = h.policy().policy.plugins;
    if (name === 'run_flow' && !plugins.automation || name === 'bridge_quote' && !plugins.bridge) continue;
    const { $schema, ...schema } = z.toJSONSchema(tool.schema);
    paths['/tools/' + name] = { post: { operationId: name, summary: tool.description, security: [{ bearer: [] }],
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: { '200': { description: 'Structured tool outcome; inspect evidence and status.', content: { 'application/json': { schema: { type: 'object' } } } },
        '403': { description: 'Authority refused' }, '503': { description: 'Unknown or unavailable; inspect persisted operation status.' } } } };
  }
  return { openapi: '3.1.0', info: { title: 'Shucamoxa guarded tools', version: '1.0.0' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, paths };
}
const hash = (s: string) => createHash('sha256').update(s).digest();
export function createHarnessServer(h: Harness, credentials: { owner: string; agent: string }) {
  if (credentials.owner.length < 32 || credentials.agent.length < 32 || credentials.owner === credentials.agent)
    throw new Error('Distinct owner and agent credentials of at least 32 characters required');
  const tokens = { owner: hash(credentials.owner), agent: hash(credentials.agent) };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'sha256-" + createHash('sha256').update(dashboard.script).digest('base64') + "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(dashboard.html); return;
      }
      if (req.method === 'GET' && req.url === '/health') { send(200, { ok: true, evidence: h.adapters.evidence }); return; }
      if (req.method === 'GET' && req.url === '/openapi.json') { send(200, openapi(h)); return; }
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      const presented = hash(bearer ?? '');
      const role = bearer && timingSafeEqual(tokens.owner, presented) ? 'owner' : bearer && timingSafeEqual(tokens.agent, presented) ? 'agent' : undefined;
      if (!role) { send(401, { code: 'NOT_AUTHORIZED' }); return; }
      // Browser traffic must use the same origin. Non-browser clients authenticate with Bearer tokens.
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) { send(403, { code: 'ORIGIN_REFUSED' }); return; }
      if (req.url?.startsWith('/owner/')) {
        if (role !== 'owner') { send(403, { code: 'OWNER_REQUIRED' }); return; }
        if (req.method === 'GET' && req.url === '/owner/state') {
          send(200, { ...h.policy(), capabilities: h.catalog(), audit: h.verify(), entries: h.audit().slice(-100) }); return;
        }
        if (req.method === 'PUT' && req.url === '/owner/policy') {
          const body = HarnessPolicyUpdate.parse(await readBody(req)); send(200, h.update(body.expectedVersion, body.policy)); return;
        }
      }
      if (req.method === 'POST' && req.url?.startsWith('/tools/')) {
        const name = req.url.slice('/tools/'.length);
        if (!Object.hasOwn(toolSchemas, name)) { send(404, { code: 'TOOL_NOT_FOUND' }); return; }
        send(200, await callTool(h, name as ToolName, await readBody(req))); return;
      }
      send(404, { code: 'NOT_FOUND' });
    } catch (e) {
      if (e instanceof HarnessError) { send(e.code === 'AUDIT_UNAVAILABLE' ? 503 : 409, { code: e.code }); return; }
      if (e instanceof z.ZodError || e instanceof SyntaxError) { send(400, { code: 'INVALID_REQUEST' }); return; }
      // Never forward provider errors, token-bearing URLs, stack traces or raw responses.
      if (!res.headersSent) send(503, { status: 'unknown', code: 'OUTCOME_UNAVAILABLE', instruction: 'Inspect the stored target. Do not pay with a new intent or resource.' });
      else res.end();
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000;
  return server;
}
async function readBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HarnessError('JSON_REQUIRED');
  const chunks: Buffer[] = []; let size = 0;
  for await (const raw of req) { const chunk = Buffer.from(raw); size += chunk.length;
    if (size > 65536) throw new HarnessError('BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
