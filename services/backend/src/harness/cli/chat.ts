/* pnpm harness:cli — chat with any model through the Shucamoxa harness, no Open WebUI needed.
 *
 *   pnpm harness:cli                                   # local Ollama, auto-picks an installed model
 *   pnpm harness:cli --model qwen3:4b
 *   pnpm harness:cli --model-url https://api.example.com/v1 --model some-model   # OpenAI-compatible; key in MODEL_API_KEY
 *   pnpm harness:cli --offline                         # no model: slash commands only
 *   pnpm harness:cli --once "can I pay Thabo?"         # one message, then exit
 *
 * Approvals happen in the owner console (http://localhost:8091) or `pnpm harness:owner` in another terminal. */
import { createInterface } from 'node:readline';
import { CliError, HarnessClient, Session, connect, chat as _chat, detectKind, pickOllamaModel, systemPrompt, outcomeOf, DEMO_STATE, type ModelOptions } from './core';
import { startEmbedded } from './embedded';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c('2'), red = c('31'), green = c('32'), blue = c('34'), bold = c('1');
const out = (s = '') => process.stdout.write(s + '\n');

export type ChatArgs = { harnessUrl: string; modelUrl: string; model?: string; agentTokenFile?: string; offline: boolean; once?: string; embed: boolean; timeoutMs: number };
export function parseArgs(argv: string[]): ChatArgs {
  const a: ChatArgs = { harnessUrl: process.env.SHX_HARNESS_URL ?? 'http://127.0.0.1:8091', modelUrl: process.env.MODEL_BASE_URL ?? 'http://127.0.0.1:11434',
    model: process.env.MODEL_NAME, offline: false, embed: true, timeoutMs: Number(process.env.SHX_MODEL_TIMEOUT_MS ?? 120000) };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!, v = () => { const x = argv[++i]; if (x === undefined) throw new CliError('ARGS', 'Missing value for ' + k); return x; };
    if (k === '--harness-url') a.harnessUrl = v(); else if (k === '--model-url') a.modelUrl = v(); else if (k === '--model') a.model = v();
    else if (k === '--agent-token-file') a.agentTokenFile = v(); else if (k === '--offline') a.offline = true; else if (k === '--once') a.once = v();
    else if (k === '--no-embed') a.embed = false; else if (k === '--timeout') a.timeoutMs = Number(v()) * 1000;
    else if (k === '--help' || k === '-h') { out(HELP_ARGS); process.exit(0); }
    else throw new CliError('ARGS', 'Unknown option ' + k + '. Use --help.');
  }
  return a;
}
const HELP_ARGS = `Usage: pnpm harness:cli [--model NAME] [--model-url URL] [--harness-url URL] [--agent-token-file PATH] [--offline] [--once TEXT] [--no-embed] [--timeout SECONDS]
Model URL ending in /v1 = OpenAI-compatible (key from MODEL_API_KEY); otherwise native Ollama.`;
const HELP = `Talk normally, e.g. "pay Thabo Supplies 100 RLUSD" or "stop asking me for Thabo, 500 a month".
Commands (work without a model):
  /payees              approved payees and limits        /proposals   what the owner has decided
  /status              evidence mode, plugins, targets   /tools       tools this agent may use
  /call TOOL {json}    call a harness tool directly      /reset       clear the conversation
  /model               model in use                      /exit        quit
Approvals: owner console http://localhost:8091 or \`pnpm harness:owner watch\` in another terminal.`;

async function command(line: string, s: { h: HarnessClient; session?: Session; model?: ModelOptions; tools: { function: { name: string; description: string } }[] }) {
  const [cmd, ...rest] = line.trim().split(/\s+/); const arg = line.trim().slice(cmd!.length).trim();
  const show = (r: { status: number; json: any }) => out(dim(JSON.stringify(r.json, null, 2)));
  switch (cmd) {
    case '/help': out(HELP); return true;
    case '/tools': for (const t of s.tools) out(`  ${bold(t.function.name)}  ${dim(t.function.description)}`); return true;
    case '/payees': {
      const r = await s.h.call('list_payees', {}); if (r.status !== 200) { out(red(outcomeOf(r.status, r.json))); return true; }
      if (!r.json.payees.length) out(dim('No approved payees yet. Ask the agent to add one; the owner confirms it.'));
      for (const p of r.json.payees) out(`  ${bold(p.name)} ${dim(p.payeeId)}  ${p.address}  ${p.mandate ? `${p.mandate.cap}/${p.mandate.period} · spent ${p.mandate.spentThisPeriod} · left ${p.mandate.remaining}` : dim('asks every time')}`);
      return true;
    }
    case '/proposals': {
      const r = await s.h.call('list_proposals', {}); if (r.status !== 200) { out(red(outcomeOf(r.status, r.json))); return true; }
      if (!r.json.proposals.length) out(dim('No proposals yet.'));
      for (const p of r.json.proposals) out(`  ${p.status.padEnd(26)} ${p.kind.padEnd(8)} ${p.summary}`);
      return true;
    }
    case '/status': show(await s.h.call('get_capabilities', {})); return true;
    case '/call': {
      const name = rest[0]; if (!name) { out('Usage: /call TOOL {json}'); return true; }
      const raw = arg.slice(name.length).trim() || '{}'; let body: unknown;
      try { body = JSON.parse(raw); } catch { out(red('Arguments must be JSON, e.g. /call pay_payee {"payeeId":"thabo_supplies","amount":"100.00"}')); return true; }
      const r = await s.h.call(name, body); out((r.status === 200 ? green : red)(outcomeOf(r.status, r.json))); show(r); return true;
    }
    case '/reset': if (s.session) s.session.messages = s.session.messages.slice(0, 1); out(dim('Conversation cleared.')); return true;
    case '/model': out(s.model ? `${s.model.model} via ${s.model.kind} at ${s.model.baseUrl}` : 'Offline: no model.'); return true;
    case '/exit': case '/quit': return 'exit';
    default: out(red('Unknown command. /help lists them.')); return true;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  let closeEmbedded: (() => Promise<void>) | undefined;
  let tokenFile = a.agentTokenFile;
  try { await new HarnessClient(a.harnessUrl, '').health(); }
  catch {
    const local = /^http:\/\/(127\.0\.0\.1|localhost):8091\/?$/.test(a.harnessUrl);
    if (!a.embed || !local) throw new CliError('HARNESS_DOWN', `No harness at ${a.harnessUrl}. Start it with: pnpm harness:demo`);
    out(dim('No harness running, so starting a local SIMULATED harness (owner console http://localhost:8091)…'));
    const e = await startEmbedded(DEMO_STATE); closeEmbedded = e.close; a.harnessUrl = e.url; tokenFile ??= e.agentTokenFile;
    out(dim('Owner token file for approvals: ' + e.ownerTokenFile));
  }
  try {
    const { client: h, file } = await connect(a.harnessUrl, 'agent', tokenFile);
    const health = await h.health(); const tools = await h.tools();
    let model: ModelOptions | undefined; let session: Session | undefined;
    if (!a.offline) {
      const kind = detectKind(a.modelUrl);
      try {
        const name = kind === 'ollama' ? await pickOllamaModel(a.modelUrl, a.model) : a.model;
        if (!name) throw new CliError('MODEL_MISSING', 'Pass --model for an OpenAI-compatible endpoint.');
        model = { kind, baseUrl: a.modelUrl, model: name, apiKey: process.env.MODEL_API_KEY, timeoutMs: a.timeoutMs };
        session = new Session(h, model, tools, await systemPrompt(h));
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        out(red('Model unavailable: ' + e.message)); out(dim('Continuing offline: slash commands still work through the harness. /help'));
      }
    }
    const mode = health.evidence === 'simulated' ? red('SIMULATED · no funds move') : blue('TESTNET');
    out(`${bold('shucamoxa.')} harness CLI · ${mode} · ${tools.length} tools · ${model ? model.model + ' (' + model.kind + ')' : 'offline'}`);
    out(dim(`harness ${a.harnessUrl} · agent key from ${file} · /help for commands`));
    const state = { h, session, model, tools };

    const runLine = async (line: string, signal?: AbortSignal): Promise<boolean> => {
      const text = line.trim(); if (!text) return true;
      try {
        if (text.startsWith('/')) return (await command(text, state)) !== 'exit';
        if (!session) { out(dim('No model connected. Use /payees, /call … or restart with a model.')); return true; }
        let streamed = false;
        const reply = await session.turn(text, {
          text: t => { if (!streamed) { process.stdout.write(blue('agent › ')); streamed = true; } process.stdout.write(t); },
          toolStart: (n, args) => { if (streamed) { out(); streamed = false; } out(dim(`  ↳ ${n} ${JSON.stringify(args)}`)); },
          toolEnd: (n, o, st) => out((st === 200 && !/REFUSED|NOT_|LOCKED|SUSPICIOUS|INVALID/.test(o) ? dim : red)(`    ${o}`)),
        }, signal);
        if (streamed) out(); else if (!reply) out(dim('(no reply)'));
        if (session.locked) out(red('This agent is LOCKED. The owner must unlock it: pnpm harness:owner unlock'));
      } catch (e) {
        if (e instanceof CliError) { out(); out(red(e.code === 'CANCELLED' ? 'Cancelled.' : e.message)); if (e.code !== 'CANCELLED') out(dim('The harness is unaffected. Try again, or use /payees and /call while the model is down.')); }
        else throw e;
      }
      return true;
    };

    if (a.once !== undefined) { await runLine(a.once); return; }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    let current: AbortController | undefined;
    rl.on('SIGINT', () => { if (current) current.abort(); else { rl.close(); } });
    rl.setPrompt(bold('you › ')); rl.prompt();
    for await (const line of rl) {
      current = new AbortController();
      const keep = await runLine(line, current.signal); current = undefined;
      if (!keep) break; rl.prompt();
    }
    rl.close();
  } finally { await closeEmbedded?.(); }
}

if (process.argv[1] && /cli[\\/]chat\.ts$/.test(process.argv[1])) {
  main().catch(e => { console.error(e instanceof CliError ? e.message : 'CLI stopped: ' + (e?.message ?? e)); process.exitCode = 1; });
}
export { _chat as chat };
