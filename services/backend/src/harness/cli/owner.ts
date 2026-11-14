/* pnpm harness:owner — the owner console in a terminal. Uses the OWNER token; never run it inside the agent's chat.
 *
 *   pnpm harness:owner status | pending | payees | audit | agents
 *   pnpm harness:owner confirm 1        (number from `pending`, or a proposal ID)
 *   pnpm harness:owner reject 1
 *   pnpm harness:owner watch            (prompts y/n as proposals arrive)
 *   pnpm harness:owner stop | resume    (kill switch)
 *   pnpm harness:owner unlock [agentId]
 *   pnpm harness:owner notes "Cape Town importer. Always state the wallet address."
 *   pnpm harness:owner run-due */
import { createInterface } from 'node:readline/promises';
import { CliError, HarnessClient, connect } from './core';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c('2'), red = c('31'), green = c('32'), bold = c('1');

export async function ownerCommand(h: HarnessClient, cmd: string, args: string[], print: (s: string) => void = s => console.log(s)) {
  const state = async () => { const r = await h.owner('GET', '/owner/state'); if (r.status !== 200) throw new CliError('OWNER', 'Owner state refused: ' + (r.json.code ?? r.status)); return r.json; };
  const pending = async () => (await state()).proposals.filter((p: any) => p.status === 'pending');
  const resolve = async (ref?: string) => {
    if (!ref) throw new CliError('ARGS', 'Give a number from `pending` or a proposal ID.');
    const list = await pending();
    const p = /^\d+$/.test(ref) ? list[Number(ref) - 1] : list.find((x: any) => x.id === ref || x.id.startsWith(ref));
    if (!p) throw new CliError('NOT_FOUND', 'No pending proposal ' + ref + '. Run `pending` to list them.');
    return p;
  };
  const listPending = (list: any[]) => {
    if (!list.length) { print(dim('Nothing waiting.')); return; }
    list.forEach((p: any, i: number) => { print(`${bold(String(i + 1))}. ${p.kind.toUpperCase()} · ${p.summary}`); if (p.data?.note) print(dim('   agent note (untrusted): ' + p.data.note)); });
  };
  const decide = async (p: any, ok: boolean) => {
    const r = await h.owner('POST', '/owner/proposals/' + (ok ? 'confirm' : 'reject'), { proposalId: p.id });
    if (r.status !== 200) throw new CliError('OWNER', 'Refused: ' + (r.json.code ?? r.status));
    const st = r.json.result?.result?.status ?? r.json.result?.status ?? r.json.result?.code;
    print((ok ? green : dim)(`${ok ? 'Confirmed' : 'Rejected'}: ${p.summary}` + (st ? ` → ${st}` : '')));
    return r.json;
  };
  const setEnabled = async (enabled: boolean) => {
    const s = await state();
    const r = await h.owner('PUT', '/owner/policy', { expectedVersion: s.version, policy: { ...s.policy, enabled } });
    if (r.status !== 200) throw new CliError('OWNER', 'Policy update refused: ' + (r.json.code ?? r.status));
    print(enabled ? green('Resumed. Agents can act again within their limits.') : red('STOPPED. Agents cannot pay, buy or run schedules until you resume.'));
  };
  switch (cmd) {
    case 'status': {
      const s = await state(); const sec = s.agentSecurity;
      print(`${bold('shucamoxa.')} ${s.capabilities.evidence === 'simulated' ? red('SIMULATED') : 'TESTNET'} · policy v${s.version} · ${s.policy.enabled ? green('running') : red('STOPPED')}`);
      print(`Default agent: ${sec.locked ? red('LOCKED · ' + (sec.reason ?? '')) : green('trusted')} · ${sec.strikes.length} recent strike(s)`);
      print(`Pending: ${s.proposals.filter((p: any) => p.status === 'pending').length} · payees: ${s.payees.length} · audit: ${s.audit.count} events, chain ${s.audit.valid === false ? red('BROKEN') : 'verified'}`);
      return s;
    }
    case 'pending': listPending(await pending()); return;
    case 'confirm': return decide(await resolve(args[0]), true);
    case 'reject': return decide(await resolve(args[0]), false);
    case 'payees': {
      const s = await state(); if (!s.payees.length) print(dim('No payees yet.'));
      for (const p of s.payees) print(`${bold(p.name)} ${dim(p.payeeId)} ${p.address} ${p.mandate ? `${p.mandate.cap}/${p.mandate.period} · spent ${p.mandate.spentThisPeriod} · left ${p.mandate.remaining}` : dim('asks every time')}`);
      return;
    }
    case 'agents': { const s = await state(); for (const a of s.agents) print(`${bold(a.name)} ${dim(a.id)} ${a.revoked ? 'revoked' : a.locked ? red('locked') : a.tools.length + ' tools'} · ${a.strikes} strike(s)`); return; }
    case 'audit': { const s = await state(); for (const e of s.entries.slice(-15)) print(`${String(e.seq).padStart(4)} ${e.event.padEnd(22)} ${(e.targetId || '—').slice(0, 16).padEnd(16)} ${e.code}`); print(dim('head ' + s.audit.head)); return; }
    case 'stop': return setEnabled(false);
    case 'resume': return setEnabled(true);
    case 'unlock': { const r = await h.owner('POST', '/owner/agent/unlock', args[0] ? { agentId: args[0] } : {}); if (r.status !== 200) throw new CliError('OWNER', 'Unlock refused: ' + (r.json.code ?? r.status)); print(green('Unlocked ' + (args[0] ?? 'default agent') + '.')); return r.json; }
    case 'notes': { const text = args.join(' '); const r = await h.owner('PUT', '/owner/instructions', { text }); if (r.status !== 200) throw new CliError('OWNER', 'Refused: ' + (r.json.code ?? r.status)); print(green('Business instructions saved.')); return; }
    case 'run-due': { const r = await h.owner('POST', '/owner/run-due', {}); print(dim(JSON.stringify(r.json))); return r.json; }
    default: throw new CliError('ARGS', 'Commands: status, pending, confirm N, reject N, watch, payees, agents, audit, stop, resume, unlock [agentId], notes TEXT, run-due');
  }
}

async function watch(h: HarnessClient) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const seen = new Set<string>(); console.log(dim('Watching for proposals. Ctrl-C to stop.'));
  let stop = false; rl.on('SIGINT', () => { stop = true; rl.close(); });
  while (!stop) {
    let list: any[] = [];
    try { const r = await h.owner('GET', '/owner/state'); list = r.status === 200 ? r.json.proposals.filter((p: any) => p.status === 'pending') : []; }
    catch { console.log(red('Harness unreachable; retrying…')); }
    for (const p of list) {
      if (seen.has(p.id) || stop) continue; seen.add(p.id);
      console.log(`\n${bold(p.kind.toUpperCase())} · ${p.summary}`); if (p.data?.note) console.log(dim('agent note (untrusted): ' + p.data.note));
      const a = (await rl.question('Confirm? [y = confirm / n = reject / Enter = later] ').catch(() => '')).trim().toLowerCase();
      if (a === 'y' || a === 'n') { try { await ownerCommand(h, a === 'y' ? 'confirm' : 'reject', [p.id]); } catch (e: any) { console.log(red(e.message)); } }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

export async function main(argv = process.argv.slice(2)) {
  let url = process.env.SHX_HARNESS_URL ?? 'http://127.0.0.1:8091', file: string | undefined; const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--harness-url') url = argv[++i]!; else if (argv[i] === '--owner-token-file') file = argv[++i]; else rest.push(argv[i]!); }
  const [cmd = 'status', ...args] = rest;
  try { await new HarnessClient(url, '').health(); } catch { throw new CliError('HARNESS_DOWN', `No harness at ${url}. Start it (pnpm harness:demo) or start the chat CLI, which starts one.`); }
  const { client } = await connect(url, 'owner', file);
  if (cmd === 'watch') return watch(client);
  await ownerCommand(client, cmd, args);
}

if (process.argv[1] && /cli[\\/]owner\.ts$/.test(process.argv[1])) {
  main().catch(e => { console.error(e instanceof CliError ? e.message : 'Owner CLI stopped: ' + (e?.message ?? e)); process.exitCode = 1; });
}
