#!/usr/bin/env python3
"""One-command local SIMULATION startup; no wallet provisioning or ledger submission."""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('webui_setup', ROOT / 'scripts/setup-webui-harness.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class StartError(Exception):
    pass


def private_dir(path):
    path = Path(path)
    if path.is_symlink():
        raise StartError('Private directories must not be symlinks.')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir() or path.stat().st_uid != os.getuid():
        raise StartError('Private directory must belong to the current user.')
    path.chmod(0o700)


def write_private(path, text, replace=False):
    path = Path(path)
    if path.exists() or path.is_symlink():
        setup.private_read(path)
        if not replace:
            return
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
    flags |= os.O_TRUNC if replace else os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        os.fchmod(file.fileno(), 0o600)
        file.write(text)


def provision(root, rotate_owner=False):
    for directory in (root / 'secrets', root / 'secrets/harness', root / 'secrets/webui'):
        private_dir(directory)
    for role in ('owner', 'agent'):
        path = root / 'secrets/harness' / (role + '.token')
        write_private(path, secrets.token_urlsafe(32), replace=rotate_owner and role == 'owner')
        if len(setup.private_read(path)) < 32:
            raise StartError('Harness credentials must contain at least 32 characters.')
    if setup.private_read(root / 'secrets/harness/owner.token') == setup.private_read(root / 'secrets/harness/agent.token'):
        raise StartError('Owner and agent credentials must differ.')
    env = root / '.env'
    if not env.exists():
        write_private(env, 'WEBUI_SECRET_KEY=' + secrets.token_hex(32) + '\nWEBUI_PORT=3000\n')
    if env.is_symlink() or not env.is_file():
        raise StartError('.env must be a regular file.')
    env.chmod(0o600)
    values = {}
    for line in env.read_text().splitlines():
        key, separator, value = line.strip().partition('=')
        if separator and not key.startswith('#'):
            values[key] = value.strip().strip('\"\'')
    if values.get('WEBUI_SECRET_KEY', '') in ('', 'replace-with-random-secret'):
        # Initial placeholder only. Preserve real existing keys and all other lines/history.
        lines = [line for line in env.read_text().splitlines() if not line.strip().startswith('WEBUI_SECRET_KEY=')]
        lines.append('WEBUI_SECRET_KEY=' + secrets.token_hex(32))
        write_private(env, '\n'.join(lines) + '\n', replace=True)
    port = values.get('WEBUI_PORT', '3000')
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise StartError('WEBUI_PORT must be a valid numeric port.')
    return int(port)


def override_text(port):
    return '''services:
  open-webui:
    network_mode: host
    ports: !reset []
    environment:
      HOST: "127.0.0.1"
      PORT: "%s"
      OLLAMA_BASE_URL: "http://127.0.0.1:11434"
''' % port


def request_json(opener, url, body=None, token=None, timeout=15):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with opener.open(request, timeout=timeout) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise StartError('Local service response exceeded its size limit.')
        return json.loads(raw)


def wait_ready(opener, url, timeout=180, clock=time.monotonic, pause=time.sleep):
    deadline = clock() + timeout
    while clock() < deadline:
        try:
            return request_json(opener, url)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            pause(2)
    raise StartError('Service readiness timed out. Inspect Docker Compose logs; existing data was preserved.')


def select_model(tags, requested):
    names = [entry.get('name') for entry in tags.get('models', []) if isinstance(entry.get('name'), str)]
    if requested:
        if requested not in names:
            raise StartError('Requested model is not installed in local Ollama. Check ollama list.')
        return requested
    if not names:
        raise StartError('No local model installed. Install a tool-capable model, then retry.')
    preferred = 'qwen3:1.7b-q4_K_M'
    return preferred if preferred in names else names[0]


def admin_session(opener, base, cache, relogin=False):
    if cache.exists() and not relogin:
        token = setup.private_read(cache)
        try:
            if request_json(opener, base + '/api/v1/auths/', token=token).get('role') == 'admin':
                return token
        except urllib.error.HTTPError as exc:
            if exc.code not in (401, 403):
                raise
    print('Open ' + base + ' and create the first admin account if this is a new install.', flush=True)
    print('Sign in with your Open WebUI ADMIN account. Neither entry will be displayed.', flush=True)
    login = {'email': getpass.getpass('Open WebUI email: ').strip(),
             'password': getpass.getpass('Open WebUI password: ')}
    result = request_json(opener, base + '/api/v1/auths/signin', login)
    if result.get('role') != 'admin' or not isinstance(result.get('token'), str):
        raise StartError('Admin sign-in did not complete. Finish any MFA in WebUI; use --admin-token-file for an existing session.')
    token = result['token']
    write_private(cache, token, replace=True)
    return token


def configure_ollama(opener, base, token, desired):
    config = request_json(opener, base + '/ollama/config', token=token)
    old = config.get('OLLAMA_BASE_URLS') or []
    aliases = {'http://127.0.0.1:11434', 'http://localhost:11434', 'http://host.docker.internal:11434'}
    urls = [desired if url.rstrip('/') in aliases else url for url in old]
    if desired not in urls:
        urls.append(desired)
    if urls != old or not config.get('ENABLE_OLLAMA_API'):
        request_json(opener, base + '/ollama/config/update', {
            'ENABLE_OLLAMA_API': True, 'OLLAMA_BASE_URLS': urls,
            'OLLAMA_API_CONFIGS': config.get('OLLAMA_API_CONFIGS') or {}}, token)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', help='Installed Ollama model; default prefers the existing Qwen tag')
    parser.add_argument('--rebuild', action='store_true', help='Rebuild the harness image after pulling code')
    parser.add_argument('--login', action='store_true', help='Replace the private cached WebUI session by signing in again')
    parser.add_argument('--admin-token-file', help='Existing private admin API key/session file; no password prompt')
    parser.add_argument('--no-fast', action='store_true', help='Preserve existing inference parameters instead of applying fast settings')
    parser.add_argument('--skip-warmup', action='store_true')
    parser.add_argument('--containers-only', action='store_true', help='Start containers without WebUI login or registration')
    parser.add_argument('--rotate-owner-token', action='store_true', help='Replace an exposed owner token and recreate containers, preserving state')
    args = parser.parse_args()
    if not shutil.which('docker'):
        raise StartError('Install Docker with Compose first, or use pnpm harness:demo for the owner console only.')
    os.chdir(ROOT)
    opener = urllib.request.build_opener(setup.NoRedirect(), urllib.request.ProxyHandler({}))
    try:
        tags = request_json(opener, 'http://127.0.0.1:11434/api/tags')
    except urllib.error.URLError:
        raise StartError('Local Ollama is not reachable on port 11434. Start Ollama, then rerun this command.') from None
    model = select_model(tags, args.model)
    print('Local model: ' + model, flush=True)
    port = provision(ROOT, args.rotate_owner_token)
    command = ['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'deploy/open-webui.compose.yml')]
    linux = sys.platform.startswith('linux')
    if linux:
        override = ROOT / 'secrets/webui/local-compose.yml'
        write_private(override, override_text(port), replace=True)
        command += ['-f', str(override)]
    env = {**os.environ, 'HARNESS_UID': str(os.getuid()), 'HARNESS_GID': str(os.getgid())}
    subprocess.run(command + ['config', '-q'], env=env, check=True)
    print('Starting containers; first image build may take a few minutes. Existing state is preserved.', flush=True)
    subprocess.run(command + ['up', '-d'] + (['--build'] if args.rebuild else []) +
                   (['--force-recreate'] if args.rotate_owner_token else []), env=env, check=True)
    base = 'http://127.0.0.1:' + str(port)
    wait_ready(opener, base + '/health')
    health = wait_ready(opener, 'http://127.0.0.1:8091/health')
    if health.get('evidence') != 'simulated':
        raise StartError('Expected the local SIMULATION harness; refused automatic registration against another mode.')
    if args.containers_only:
        print('Containers ready. WebUI: ' + base + ' | owner console: http://localhost:8091')
        return
    token = setup.private_read(args.admin_token_file) if args.admin_token_file else admin_session(
        opener, base, ROOT / 'secrets/webui/admin.session', args.login)
    configure_ollama(opener, base, token, 'http://127.0.0.1:11434' if linux else 'http://host.docker.internal:11434')
    result = setup.install(base, 'http://127.0.0.1:8091' if linux else 'http://harness:8091', token,
        setup.private_read(ROOT / 'secrets/harness/agent.token'), model, opener,
        fast=not args.no_fast, allow_local_migration=linux)
    # Probe THROUGH WebUI too, so a host-only Ollama success cannot conceal broken Docker reachability.
    listed = request_json(opener, base + '/api/models', token=token)
    if model not in {entry.get('id') for entry in listed.get('data', [])}:
        raise StartError('Registration completed, but WebUI cannot list the selected base model. Inspect its Ollama connection.')
    if not args.skip_warmup:
        print('Warming the local model (up to 60 seconds); no payment tools are called.', flush=True)
        try:
            request_json(opener, 'http://127.0.0.1:11434/api/generate',
                {'model': model, 'prompt': '', 'stream': False, 'keep_alive': '30m', 'think': False, 'options': {'num_ctx': 8192}}, timeout=60)
        except (urllib.error.URLError, TimeoutError):
            print('Warmup did not complete; first chat may still load the model. Registration succeeded.', flush=True)
    print('Ready: SIMULATION — no blockchain funds move.')
    print('WebUI: ' + base + ' → select Shucamoxa · Governed Finance → start a NEW chat.')
    print('Owner console: http://localhost:8091 | private login file: secrets/harness/owner.token')
    print('Optional plugins: owner console → Extensions → Automated flows / Bridge routing.')
    print('Scenario check: pnpm demo:check | Evidence: ' + result['preset'])


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as exc:
        print('Startup stopped: HTTP %s at %s. No response body or credential logged.' %
              (exc.code, urlsplit(exc.url).path), file=sys.stderr)
        sys.exit(1)
    except StartError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt) as exc:
        print('Startup stopped (%s). No secret details logged; data was preserved.' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
