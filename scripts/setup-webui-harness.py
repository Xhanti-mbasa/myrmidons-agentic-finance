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


def install(base_url, harness_url, api_key, agent_key, model, opener=None):
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
    if existing and any(c.get('url', '').rstrip('/') != harness_url for c in existing):
        raise ValueError('Existing shucamoxa connection points elsewhere; review it in WebUI before replacing')
    connection = {'url': harness_url, 'path': 'openapi.json', 'type': 'openapi', 'auth_type': 'bearer',
                  'key': agent_key, 'config': {'enable': True}, 'info': {'id': 'shucamoxa', 'name': 'Shucamoxa governed tools'}}
    merged = [c for c in connections if (c.get('info') or {}).get('id') != 'shucamoxa'] + [connection]
    call('/api/v1/configs/tool_servers', {'TOOL_SERVER_CONNECTIONS': merged})
    preset = {'id': 'shucamoxa-finance', 'base_model_id': model, 'name': 'Shucamoxa · Governed Finance',
              'is_active': True, 'params': {'system': (ROOT / 'config/harness-system-prompt.txt').read_text(),
                                          'function_calling': 'native'},
              'meta': {'description': 'Owner-controlled finance harness. Inspect evidence mode before reporting a payment.',
                       'toolIds': ['server:shucamoxa'], 'capabilities': {'vision': False, 'file_upload': False}},
              'access_grants': []}
    try:
        call('/api/v1/models/model?id=shucamoxa-finance')
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        call('/api/v1/models/create', preset)
    else:
        # Preserve an existing model's owner-edited prompt/settings. Registering twice is safe.
        return {'tools_registered': True, 'preset': 'already_present_preserved'}
    return {'tools_registered': True, 'preset': 'created'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--webui-url', default='http://127.0.0.1:3000')
    p.add_argument('--harness-url', default='http://harness:8091', help='Address reachable FROM the WebUI container')
    p.add_argument('--agent-token-file', default='secrets/harness/agent.token')
    p.add_argument('--admin-token-file')
    p.add_argument('--base-model', required=True, help='Installed model ID with native tool calling')
    args = p.parse_args()
    key = private_read(args.admin_token_file) if args.admin_token_file else getpass.getpass('Open WebUI admin API key/session token: ')
    result = install(args.webui_url, args.harness_url, key, private_read(args.agent_token_file), args.base_model)
    print(json.dumps(result))
    print('Open WebUI → select Shucamoxa · Governed Finance. Tools use the agent credential only.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Registration failed. Check the admin credential, WebUI API version, installed model and container reachability. No secret details logged.', file=sys.stderr)
        sys.exit(1)
