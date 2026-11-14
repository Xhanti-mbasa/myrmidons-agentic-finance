#!/usr/bin/env python3
"""Register the guarded server and a model preset using Open WebUI's admin API.
Reads API/agent credentials from private files or a hidden prompt. Never logs secrets.
"""
import argparse
import getpass
import json
from pathlib import Path
import sys
from urllib.parse import urlparse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def private_read(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Credential must be a private regular file (0600)')
    return path.read_text().strip()


def validate_url(value):
    url = urlparse(value)
    if url.username or url.password or url.query or url.fragment or url.path not in {'', '/'} or not (
        url.scheme == 'https' or url.scheme == 'http' and url.hostname in {'localhost', '127.0.0.1', 'harness'}
    ):
        raise ValueError('Use loopback/private Docker hostname or HTTPS origin')
    return value.rstrip('/')


FAST_PARAMS = {'think': False, 'temperature': 0, 'max_tokens': 512,
               'num_ctx': 8192, 'num_predict': 512, 'keep_alive': '24h'}
# Open WebUI runs these extra generations on the SAME local model after every reply
# (title, tags, follow-up chips, autocomplete). On one local GPU/CPU they queue in front
# of the next answer, so the finance demo turns them off.
BACKGROUND_TASKS = ('ENABLE_TITLE_GENERATION', 'ENABLE_TAGS_GENERATION', 'ENABLE_FOLLOW_UP_GENERATION',
                    'ENABLE_AUTOCOMPLETE_GENERATION', 'ENABLE_SEARCH_QUERY_GENERATION',
                    'ENABLE_RETRIEVAL_QUERY_GENERATION')
# Earlier shipped prompts began with this line and told the model to call three tools
# before answering. Replace them on --fast; any owner-written prompt is preserved.
SHIPPED_PROMPT_PREFIX = 'You are Shucamoxa, '
# Open WebUI 0.13.3 otherwise defaults builtin tool injection to True for native FC.
# Disable automatic task/automation/memory/code tools on this finance preset.
FINANCE_CAPABILITIES = {'vision': False, 'file_upload': False, 'builtin_tools': False,
                        'code_interpreter': False, 'terminal': False, 'web_search': False}


def finance_meta(meta):
    return {**(meta or {}), 'toolIds': ['server:shucamoxa'],
            'capabilities': {**((meta or {}).get('capabilities') or {}), **FINANCE_CAPABILITIES}}


def install(base_url, harness_url, api_key, agent_key, model, opener=None, *, fast=False,
            allow_local_migration=False):
    base_url = validate_url(base_url)
    harness_url = validate_url(harness_url)
    if len(agent_key) < 32 or not api_key or api_key == agent_key:
        raise ValueError('Distinct admin and agent credentials required')
    opener = opener or urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))

    def call(path, body=None):
        request = urllib.request.Request(base_url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'})
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    # Preserve all unrelated connections. Refuse to repoint an existing server with this ID.
    connections = call('/api/v1/configs/tool_servers').get('TOOL_SERVER_CONNECTIONS') or []
    existing = [c for c in connections if (c.get('info') or {}).get('id') == 'shucamoxa']
    changed = [c for c in existing if c.get('url', '').rstrip('/') != harness_url]
    if changed:
        local_aliases = {'http://harness:8091', 'http://127.0.0.1:8091'}
        if not (allow_local_migration and harness_url in local_aliases and
                all(c.get('url', '').rstrip('/') in local_aliases for c in changed)):
            raise ValueError('Existing shucamoxa connection points elsewhere; review it in WebUI before replacing')
        # Verify the new local endpoint accepts the actual scoped agent credential before migration.
        request = urllib.request.Request(harness_url + '/tools/get_capabilities', data=b'{}',
            headers={'Authorization': 'Bearer ' + agent_key, 'Content-Type': 'application/json'})
        with opener.open(request, timeout=10) as response:
            if json.load(response).get('evidence') not in {'simulated', 'testnet'}:
                raise ValueError('Local harness verification failed')
    connection = {'url': harness_url, 'path': 'openapi.json', 'type': 'openapi', 'auth_type': 'bearer',
                  'key': agent_key, 'config': {'enable': True}, 'info': {'id': 'shucamoxa', 'name': 'Shucamoxa governed tools'}}
    merged = [c for c in connections if (c.get('info') or {}).get('id') != 'shucamoxa'] + [connection]
    call('/api/v1/configs/tool_servers', {'TOOL_SERVER_CONNECTIONS': merged})
    shipped_prompt = (ROOT / 'config/harness-system-prompt.txt').read_text()
    preset = {'id': 'shucamoxa-finance', 'base_model_id': model, 'name': 'Shucamoxa · Governed Finance',
              'is_active': True, 'params': {'system': shipped_prompt,
                                          'function_calling': 'native'},
              'meta': finance_meta({'description': 'Owner-controlled finance harness. Inspect evidence mode before reporting a payment.'}),
              'access_grants': []}
    if fast:
        preset['params'].update(FAST_PARAMS)
    tasks = 'unchanged'
    if fast:
        try:
            config = call('/api/v1/tasks/config')
            if any(config.get(k) for k in BACKGROUND_TASKS if k in config):
                call('/api/v1/tasks/config/update', {**config, **{k: False for k in BACKGROUND_TASKS if k in config}})
            tasks = 'background_generation_off'
        except (urllib.error.URLError, ValueError, TypeError):
            tasks = 'background_generation_unchanged'
    try:
        current = call('/api/v1/models/model?id=shucamoxa-finance')
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        call('/api/v1/models/create', preset)
        return {'tools_registered': True, 'preset': 'created', 'tasks': tasks}
    else:
        hardened_meta = finance_meta(current.get('meta'))
        if fast or hardened_meta != current.get('meta'):
            # Preserve owner text/unrelated settings, but always restrict this preset's tool surface.
            updated = {key: current[key] for key in
                       ('id', 'base_model_id', 'name', 'is_active', 'params', 'meta', 'access_grants') if key in current}
            if updated.get('id') != 'shucamoxa-finance':
                raise ValueError('Unexpected model response; no preset changed')
            updated['meta'] = hardened_meta
            if fast:
                updated['base_model_id'] = model
                updated['params'] = {**(current.get('params') or {}), **FAST_PARAMS}
                if str(updated['params'].get('system', '')).startswith(SHIPPED_PROMPT_PREFIX):
                    updated['params']['system'] = shipped_prompt
            call('/api/v1/models/model/update', updated)
            return {'tools_registered': True, 'preset': 'fast_settings_updated' if fast else 'tool_scope_updated', 'tasks': tasks}
        # Preserve an existing model's owner-edited prompt/settings. Registering twice is safe.
        return {'tools_registered': True, 'preset': 'already_present_preserved', 'tasks': tasks}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--webui-url', default='http://127.0.0.1:3000')
    p.add_argument('--harness-url', default='http://harness:8091', help='Address reachable FROM the WebUI container')
    p.add_argument('--agent-token-file', default='secrets/harness/agent.token')
    p.add_argument('--admin-token-file')
    p.add_argument('--base-model', required=True, help='Installed model ID with native tool calling')
    p.add_argument('--fast', action='store_true', help='Disable thinking and bound replies on the finance preset')
    args = p.parse_args()
    key = private_read(args.admin_token_file) if args.admin_token_file else getpass.getpass('Open WebUI admin API key/session token: ')
    result = install(args.webui_url, args.harness_url, key, private_read(args.agent_token_file), args.base_model, fast=args.fast)
    print(json.dumps(result))
    print('Open WebUI → select Shucamoxa · Governed Finance. Tools use the agent credential only.')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as exc:
        print('Registration failed: HTTP %s at %s. No response body or credential logged.' %
              (exc.code, urlparse(exc.url).path), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Registration failed. Check the admin credential, WebUI API version, installed model and container reachability. No secret details logged.', file=sys.stderr)
        sys.exit(1)
