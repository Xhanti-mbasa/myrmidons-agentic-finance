#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command -v docker >/dev/null 2>&1 || { echo 'Install Docker with Compose, or run pnpm harness:demo for the standalone owner console.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node 22 is required to provision private credentials.' >&2; exit 1; }
# Only initialize missing files. Existing credentials, policy, chat history and audit persist.
umask 077
mkdir -p secrets/harness
chmod 700 secrets/harness
node --input-type=module - <<'JS'
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, lstatSync } from 'node:fs';
for (const role of ['owner', 'agent']) {
  const path = 'secrets/harness/' + role + '.token';
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('Private credential permissions required');
}
if (!existsSync('.env')) writeFileSync('.env', 'WEBUI_SECRET_KEY=' + randomBytes(32).toString('hex') + '\nWEBUI_PORT=3000\nWEBUI_OLLAMA_URL=http://host.docker.internal:11434\n', { flag: 'wx', mode: 0o600 });
JS
HARNESS_UID="$(id -u)"
HARNESS_GID="$(id -g)"
export HARNESS_UID HARNESS_GID
docker compose --env-file .env -f deploy/open-webui.compose.yml up -d --build
printf '%s\n' 'Open WebUI: http://localhost:3000' 'Owner controls: http://localhost:8091' 'Owner token is in secrets/harness/owner.token. Paste it only into the owner console.' 'After first admin login, register the tools with scripts/setup-webui-harness.py.'
