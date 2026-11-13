#!/usr/bin/env python3
"""One-command runner. Installs nothing, never accesses an XRPL node, never prints canaries."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
python = str(ROOT / ".venv/bin/python") if (ROOT / ".venv/bin/python").exists() else sys.executable
node = shutil.which("node")
pnpm = os.environ.get("PNPM_BIN", shutil.which("pnpm") or "")
gitleaks = os.environ.get("GITLEAKS_BIN", shutil.which("gitleaks") or "")
if not node or not gitleaks or not pnpm or not (ROOT / "node_modules/vitest/vitest.mjs").exists():
    sys.exit("Install Node 22, pinned pnpm dependencies, Python .[chat], and gitleaks 8.30.1 first (see security/README.md).")
version = subprocess.check_output([gitleaks, "version"], text=True).strip()
if version != "8.30.1": sys.exit("Reproduction requires gitleaks 8.30.1; review scanner changes before updating the pin.")
with tempfile.TemporaryDirectory(prefix="shucamoxa-security-results-") as folder:
    env = {**os.environ, "SECURITY_RESULTS_DIR": folder, "GITLEAKS_BIN": gitleaks, "PNPM_BIN": pnpm}
    commands = [[node, "node_modules/typescript/bin/tsc", "-p", "security/tsconfig.json"],
                [node, "node_modules/vitest/vitest.mjs", "run", "--config", "security/vitest.config.ts", "--reporter=verbose"],
                [python, "security/test_python.py"],
                [gitleaks, "git", "--log-opts=--full-history HEAD", "--config", ".gitleaks.toml", "--redact", "--no-banner", "."],
                ["sh", "scripts/check-tracked-paths.sh"]]
    codes = []
    for command in commands:
        codes.append(subprocess.run(command, env=env, check=False).returncode)
    results = sorted((json.loads(p.read_text()) for p in Path(folder).glob("*.json")), key=lambda r: r["id"])
    counts = {name: sum(r["result"] == name for r in results) for name in ["BLOCKED", "VULNERABLE", "NOT_IMPLEMENTED"]}
    baseline = ROOT / "security/evidence/results.json"
    if baseline.exists():
        expected_ids = {r["id"] for r in json.loads(baseline.read_text())["tests"]}
        if {r["id"] for r in results} != expected_ids:
            print("Case inventory changed or a probe did not run; review against retained evidence.")
            codes.append(1)
    suite_sources = sorted(p for p in (ROOT / "security").iterdir() if p.suffix in {".ts", ".py", ".json"})
    suite_digest = hashlib.sha256(b"".join(p.name.encode() + b"\0" + p.read_bytes() + b"\0" for p in suite_sources)).hexdigest()
    assessed_base = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    report = {"suite_source_sha256": suite_digest, "assessed_base": assessed_base, "runtime_node": subprocess.check_output([node, "--version"], text=True).strip(),
              "runtime_python": subprocess.check_output([python, "--version"], text=True).strip(), "gitleaks": version,
              "working_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], text=True).strip()), "commands_successful": all(code == 0 for code in codes), "counts": counts, "validated_testnet_transactions": [], "tests": results}
    output = ROOT / "artifacts/security"; output.mkdir(parents=True, exist_ok=True)
    (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print("\nSecurity outcomes:", json.dumps(counts), flush=True)
    print("Known vulnerabilities and NOT_IMPLEMENTED cases are expected failures, NOT blocked attacks.", flush=True)
    print("Sanitized evidence: artifacts/security/results.json", flush=True)
    if not results or any((r["result"] == "BLOCKED") != r["safe"] for r in results): codes.append(1)
    if os.environ.get("SECURITY_REQUIRE_ALL_BLOCKED") == "1" and any(r["result"] != "BLOCKED" for r in results): codes.append(1)
    sys.exit(1 if any(codes) else 0)
