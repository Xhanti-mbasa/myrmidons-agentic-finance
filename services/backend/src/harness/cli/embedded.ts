/* Fallback: when no harness is running, the CLI starts the same SIMULATED demo harness
 * (same state directory, tokens, rules and owner console on :8091) that `pnpm harness:demo` starts. */
import { mkdirSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Harness } from '../core';
import { createHarnessServer } from '../http';
import { createDemo } from '../demo';
import { readPrivate } from './core';

export async function startEmbedded(state: string, port = 8091) {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const s = lstatSync(state);
  if (!s.isDirectory() || s.isSymbolicLink() || (process.platform !== 'win32' && (s.mode & 0o077) !== 0)) throw new Error('Private state directory required: ' + state);
  for (const role of ['owner', 'agent']) {
    const p = join(state, role + '.token');
    if (!existsSync(p)) writeFileSync(p, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  }
  const owner = readPrivate(join(state, 'owner.token')), agent = readPrivate(join(state, 'agent.token'));
  const fixture = createDemo(state);
  const h = new Harness(join(state, 'harness.db'), fixture.adapters, fixture.initial);
  const server = createHarnessServer(h, { owner, agent });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  let ticking = false;
  const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await h.runDue(); } catch { /* retried next tick */ } finally { ticking = false; } }, 30000);
  timer.unref();
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return { url, agentTokenFile: join(state, 'agent.token'), ownerTokenFile: join(state, 'owner.token'),
    close: () => new Promise<void>(r => { clearInterval(timer); server.close(() => { h.close(); fixture.close(); r(); }); }) };
}
