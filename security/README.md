# Adversarial suite

Run from the repository root after the normal development dependencies are installed:

```sh
python3 security/run.py
```

Requirements: Node **22**, repository-pinned pnpm **10.28.0**, Python **3.11+**, the
`.[chat]` extra, and **gitleaks 8.30.1** on PATH (or `GITLEAKS_BIN=/absolute/path`).
The CI workflow installs these and verifies the gitleaks release checksum.
For a fresh checkout:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[chat]'
# Install gitleaks using the checksum-pinned commands in .github/workflows/security.yml.
python3 security/run.py
```

The runner performs security-suite typechecking, TypeScript and Python adversarial
tests, full HEAD history secret scanning and the tracked-path guard. It writes a
sanitized result file to `artifacts/security/results.json`. This directory is
ignored. `security/evidence/results.json` is the explicitly retained assessment
snapshot, not a claim about future runs. Setup failures and unexpected passes
fail the run. Known unsafe outcomes are **expected failures of safety assertions**,
not passing security controls. Probe setup runs in hooks, so an unrelated exception
cannot masquerade as a reproduced vulnerability. The runner additionally checks
that each recorded safety result matches its declared classification.

`SECURITY_REQUIRE_ALL_BLOCKED=1 python3 security/run.py` is the strict readiness gate:
it fails while any recorded vulnerability or missing control remains. The normal
CI job is a regression/evidence job, **not a deployment security approval**.

## Evidence boundaries

- `payment.test.ts`: production coordinator and temporary SQLite databases with
  explicit simulated policy/wallet responses. No fake signer is a security oracle.
- `agent.test.ts`: production extraction/agent/tools with forced adversarial model
  outputs and a recording backend; no inference endpoint or external model is used.
- `audit.test.ts`: production chain functions and destructive changes to disposable
  SQLite databases only. DB-writer attacks assume that stronger privilege.
- `test_python.py`: actual stdio MCP child and loopback backend; gateway/parser tests;
  real gitleaks CLI with ephemeral synthetic canaries. No onboarding provisioning,
  GitHub API, Tailscale API or shared model-host connection occurs.
- `missing-controls.test.ts`: concrete XRPL mutation vectors and safety assertions
  tagged `NOT_IMPLEMENTED`. They stop at the missing production co-signer/wallet;
  they are **not executed XRPL attacks**. New production implementations require
  wiring the vectors into their real APIs. Do not turn these green with test doubles.

No public XRPL node is contacted. There are **zero validated Testnet transaction
hashes**. `tefBAD_QUORUM` and `tefMASTER_DISABLED` are rejection results, not successful
validated ledger transactions; future evidence must record the fresh treasury's
validated setup hashes, rejected signed transaction hash, submit response, and
subsequent validated-ledger state/expiry evidence. A `tef` response alone must not
be labelled a validated transaction. Delivered amount must come from validated
transaction metadata. Fresh wallets and public Testnet are mandatory when adding
that integration; never retain keys or seeds in evidence.

The workflow and report map selected controls to ASVS 5.0.0 L1/L2 requirements
within the requested L2 target, OWASP LLM Top 10 2025, CCSS v9 and XRPL guidance.
This is not exhaustive coverage of any standard. See `SECURITY_ASSESSMENT.md`.
