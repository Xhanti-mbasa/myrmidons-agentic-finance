import { lstatSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HarnessPolicy } from '@shucamoxa/shared';
import { Harness } from './core';
import { createHarnessServer } from './http';
import { createDemo } from './demo';
import { httpAdapters } from './adapters';

export function privateRead(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Private regular file required');
  return readFileSync(path, 'utf8').trim();
}
function directory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0) throw new Error('Private state directory required');
}
const endpoint = z.strictObject({ url: z.url(), agentTokenFile: z.string().min(1) });
const configSchema = z.strictObject({ stateDirectory: z.string().min(1), ownerTokenFile: z.string().min(1), agentTokenFile: z.string().min(1),
  policy: HarnessPolicy, transfers: endpoint.optional(), purchases: endpoint.optional() });
async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), demo = args[0] === '--demo', init = args[0] === '--init';
  if (!demo && !init && args[0] !== '--config') throw new Error('Use --demo [private-directory], --init [private-directory], or --config /private/config.json');
  const defaultDirectory = join(homedir(), '.local/state/shucamoxa-harness/demo');
  const state = resolve(args[1] && !args[1].startsWith('--') ? args[1] : defaultDirectory);
  let h: Harness, owner: string, agent: string, closeDemo = () => {};
  if (demo || init) {
    directory(state);
    for (const role of ['owner', 'agent']) {
      const path = join(state, role + '.token');
      if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
      privateRead(path);
    }
    owner = privateRead(join(state, 'owner.token')); agent = privateRead(join(state, 'agent.token'));
    if (init) { console.log('Private demo credentials prepared. No wallet loaded or payment submitted.'); return; }
    const fixture = createDemo(state); closeDemo = fixture.close;
    h = new Harness(join(state, 'harness.db'), fixture.adapters, fixture.initial);
  } else {
    const config = configSchema.parse(JSON.parse(privateRead(state))); directory(config.stateDirectory);
    owner = privateRead(config.ownerTokenFile); agent = privateRead(config.agentTokenFile);
    const toEndpoint = (v?: z.infer<typeof endpoint>) => v ? { url: v.url, token: privateRead(v.agentTokenFile) } : undefined;
    const backendTokens = [config.transfers, config.purchases].filter(Boolean).map(v => privateRead(v!.agentTokenFile));
    if (backendTokens.some(t => t === owner || t === agent)) throw new Error('Backend, harness owner and harness agent tokens must be distinct');
    h = new Harness(join(config.stateDirectory, 'harness.db'), httpAdapters(toEndpoint(config.transfers), toEndpoint(config.purchases)), config.policy);
  }
  const server = createHarnessServer(h, { owner, agent });
  const host = args.includes('--container') ? '0.0.0.0' : '127.0.0.1';
  server.listen(8091, host, () => {
    console.log('Shucamoxa owner console: http://localhost:8091');
    console.log(demo ? 'SIMULATION: no blockchain funds move. Owner token file: ' + join(state, 'owner.token') : 'TESTNET adapter mode: live settlement requires the configured private backends.');
  });
  // Scheduler: pays owner-confirmed scheduled payments when due. Respects the kill switch.
  let ticking = false;
  const tick = async () => { if (ticking) return; ticking = true;
    try { const r = await h.runDue(); const ran = 'results' in r ? r.results ?? [] : []; if (ran.length) console.log('Scheduler ran ' + ran.length + ' due payment(s).'); }
    catch { console.error('Scheduler run failed; payments remain stored for the next run.'); } finally { ticking = false; } };
  const timer = setInterval(() => void tick(), 30000); void tick();
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; clearInterval(timer); server.close(() => { h.close(); closeDemo(); }); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
void main().catch(() => { console.error('Harness refused startup. Check private configuration, file permissions and audit integrity.'); process.exitCode = 1; });
