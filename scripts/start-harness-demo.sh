#!/bin/sh
# Complete local simulation setup; forwards --model, --rebuild, --login and other options.
set -eu
exec python3 "$(dirname "$0")/start-local-demo.py" "$@"
