#!/usr/bin/env python3
"""Time the local model with the exact prompt and tools Open WebUI sends it.

  python3 scripts/model-speed.py                 # model from the WebUI preset default
  python3 scripts/model-speed.py --model qwen3:4b

Talks to Ollama (127.0.0.1:11434) and reads the tool list from the harness
(127.0.0.1:8091) with the private agent token. Calls no tools and moves no funds.
"""
import argparse
import json
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OLLAMA = 'http://127.0.0.1:11434'
NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(url, body=None, token=None, timeout=180):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with NO_PROXY.open(req, timeout=timeout) as r:
        return json.load(r)


def tools_from_harness(token):
    spec = get('http://127.0.0.1:8091/openapi.json', token=token)
    return [{'type': 'function', 'function': {'name': op['post']['operationId'], 'description': op['post']['summary'],
             'parameters': op['post']['requestBody']['content']['application/json']['schema']}}
            for op in spec['paths'].values()]


def run(model, system, tools, text, ctx):
    t0 = time.monotonic()
    r = get(OLLAMA + '/api/chat', {'model': model, 'stream': False, 'think': False, 'keep_alive': '24h',
            'options': {'num_ctx': ctx, 'temperature': 0, 'num_predict': 256},
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': text}], 'tools': tools})
    wall = time.monotonic() - t0
    ns = 1e9
    pe, pd = r.get('prompt_eval_count', 0), r.get('prompt_eval_duration', 0) / ns
    ec, ed = r.get('eval_count', 0), r.get('eval_duration', 0) / ns
    calls = [c['function']['name'] for c in (r.get('message') or {}).get('tool_calls') or []]
    return {'wall': wall, 'load': r.get('load_duration', 0) / ns, 'prompt_tokens': pe, 'prefill_s': pd,
            'prefill_tps': pe / pd if pd else 0, 'out_tokens': ec, 'decode_tps': ec / ed if ed else 0,
            'tool_calls': calls, 'reply': ((r.get('message') or {}).get('content') or '').strip()[:120]}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--model', default='qwen3:1.7b-q4_K_M')
    p.add_argument('--ctx', type=int, default=8192)
    p.add_argument('--agent-token-file', default=str(ROOT / 'secrets/harness/agent.token'))
    a = p.parse_args()
    system = (ROOT / 'config/harness-system-prompt.txt').read_text()
    try:
        tools = tools_from_harness(Path(a.agent_token_file).read_text().strip())
    except Exception:
        print('Harness not reachable on 8091 (or no agent token); timing the prompt without tools.', file=sys.stderr)
        tools = []
    try:
        get(OLLAMA + '/api/tags', timeout=5)
    except Exception:
        sys.exit('Ollama is not reachable on 127.0.0.1:11434. Start it, then rerun.')

    print('Model %s | %d tools | system prompt %d chars | num_ctx %d' % (a.model, len(tools), len(system), a.ctx))
    cold = run(a.model, system, tools, 'hi', a.ctx)
    print('1. first request   %5.1fs  (model load %.1fs)' % (cold['wall'], cold['load']))
    rows = [('2. "can i pay"', 'can i pay'), ('3. pay request', 'pay Thabo Supplies 100 RLUSD')]
    for label, text in rows:
        r = run(a.model, system, tools, text, a.ctx)
        print('%-18s %5.1fs  prompt %d tok @ %.0f tok/s, reply %d tok @ %.1f tok/s, tools %s' % (
            label, r['wall'], r['prompt_tokens'], r['prefill_tps'], r['out_tokens'], r['decode_tps'], r['tool_calls'] or '-'))
    ps = get(OLLAMA + '/api/ps', timeout=5).get('models') or []
    loaded = next((m for m in ps if m.get('name') == a.model or m.get('model') == a.model), None)
    print()
    if loaded:
        size, vram = loaded.get('size') or 0, loaded.get('size_vram') or 0
        share = vram / size if size else 0
        print('Placement: %d%% of the model is on the GPU.' % round(share * 100))
        if share < 0.99:
            print('  -> Part runs on CPU. Use a smaller model or a smaller num_ctx so it fits in VRAM.')
    if r['prefill_tps'] and r['prefill_tps'] < 300:
        print('Prompt reading is slow (%.0f tok/s): set OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 on the Ollama service.' % r['prefill_tps'])
    if r['decode_tps'] and r['decode_tps'] < 15:
        print('Writing is slow (%.1f tok/s): try qwen3:1.7b-q4_K_M, or a hosted OpenAI-compatible model in Open WebUI.' % r['decode_tps'])
    if cold['load'] > 2:
        print('Cold load took %.1fs: set OLLAMA_KEEP_ALIVE=24h so the model stays loaded between chats.' % cold['load'])


if __name__ == '__main__':
    main()
