#!/bin/sh
# Fails if git tracks an env file (other than .env.example) or a path that must stay local:
# CLAUDE.md, CLAUDE.local.md, CONTEXT.md, .scratch/ (at any depth), docs/agents/, docs/adr/.
# It reads the git index, so it checks tracked files in CI and staged files in the pre-commit hook.
# Run from anywhere inside the repo: sh scripts/check-tracked-paths.sh
set -eu

# -z keeps unusual file names unquoted; a newline inside a name can only add a false alarm.
files=$(git ls-files -z | tr '\0' '\n')

# Env files, except .env.example. The exemption applies to this pattern only.
env_files=$(printf '%s\n' "$files" | grep -E '(^|/)\.env(\.[^/]*)?(/|$)' |
  grep -Ev '(^|/)\.env\.example$' || true)

# Local-only paths. Nothing inside them is exempt, not even an .env.example.
local_only=$(printf '%s\n' "$files" | grep -E \
  -e '(^|/)(CLAUDE|CLAUDE\.local|CONTEXT)\.md$' \
  -e '(^|/)\.scratch/' \
  -e '^docs/(agents|adr)/' || true)

bad=$(printf '%s\n%s\n' "$env_files" "$local_only" | grep -v '^$' | sort -u || true)

if [ -n "$bad" ]; then
  {
    echo "check-tracked-paths: these files must never be committed (env files or local-only paths):"
    printf '%s\n' "$bad" | while IFS= read -r p; do echo "  $p"; done
    echo "Unstage them with: git rm --cached <path>"
  } >&2
  exit 1
fi
