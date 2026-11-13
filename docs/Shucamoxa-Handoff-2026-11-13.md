# Shucamoxa W1 handoff, Fri 13 Nov 2026, about 16:00 SAST

Repo: `Xhanti-mbasa/myrmidons-agentic-finance`. Feature freeze 18:00 today.

## Rules that still apply
- Follow `CLAUDE.md` (local only, never committed). It covers test-first, mutation checks, never weakening tests, the security rules, and §7 model fallback.
- **No Claude authorship.** No Co-Authored-By or Claude-Session trailers and no "Generated with Claude Code" footer. The git identity is `Cameron Darries <139866633+kilothejewel@users.noreply.github.com>`.
- Keep `CLAUDE.md`, `.scratch/`, `docs/agents/` local. Never create GitHub issues.
- Every ticket gets one builder agent and a separate reviewer agent. Merge only on an APPROVE verdict and green CI.
- Merge with `tools/pr.sh` (`create`, `checks`, `merge`). It uses the REST API, because GraphQL isn't available. It passes the commit message itself so no trailers come back, and it waits for every workflow run. Merged branches can't be deleted from this environment.
- gitleaks isn't installed locally. Use `tools/seedscan.sh origin/main` instead; CI runs gitleaks.

## Merged on main
| Ticket | PR | What it does |
|---|---|---|
| T01–T05, T03b, T09 | #2–#16 | Bootstrap, CI, shared contracts, rename, supplier and approval binding, env hardening |
| T06 | #15 | Extracted fields grounded in the invoice text |
| T16 | #17 | Demo invoice PDFs and red-team fixtures 09–14 |
| T10 | #18 | Timeouts and size caps; a pay with any unclear answer is "outcome unknown" and never retried |
| T15 | #19 | Mock backend and agent API contract tests |
| CI fix | #24 | The adversarial job installs `mcp_gateway` deps; SECRET-04 retired (its code was deleted in #21). Xhanti should confirm. |
| T07 | #23 | The planner sees only constrained fields; SECRET-02 is now BLOCKED |

Xhanti merged #12 (payments), #20 (adversarial suite) and #21 (Open WebUI workspace). TrenerMogau's #22 (XRPL XRP demo) is open and not reviewed.

## In flight (none of these is on main)
1. **T08, chat payment guards.**
   - Reviewed branch: `fix/t08-chat-payment-guards` at `4bcec25`.
   - Unfinished fixes: `wip/t08-review-fixes` at `3350d7b`, not reviewed, may not pass.
   - Two open review blockers:
     - **(1)** A currency word anywhere in the message must refuse. Today "Pay Karoo 30 in rand", "500 Namibian dollars", "(in ZAR)", "ZAR-equivalent" and "Kenyan shillings" all pay USD. Scan the whole message: currency words, upper-case non-USD ISO codes, symbols, and "dollars" unless directly after the number or "US".
     - **(2)** Resolve the payee against the full approved list from `GET /rules`. Require exactly one candidate equal to `supplierId`; refuse when it's ambiguous or negated ("Don't pay Karoo, pay Zambezi"); treat "pay" and legal-form words as generic.
   - Nit: refuse "30usd".
2. **T06b, grounding hardening.**
   - Reviewed branch: `fix/t06b-grounding-supplier-and-line-items` at `a86e00e`.
   - Unfinished fixes: `wip/t06b-review-fixes` at `1c69c12`, not reviewed.
   - Four open review blockers:
     - **(1)** The sum check can be skipped. Fail closed: before the total, every line containing a digit after the header must be a clean item line, and the body ends only at a total or tax line that has an amount.
     - **(2)** Minus signs, parentheses, CR/DR and discount, credit, less or refund lines go to review.
     - **(3)** Count `From:` lines across the whole body. One outside the header, or more than one, goes to review.
     - **(4)** Flip adversarial LLM-07 to BLOCKED in `security/agent.test.ts`:
       - `:50`: change `VULNERABLE` to `BLOCKED`.
       - Delete `:54`.
       - `:55`: `safe = needs_review && no planner calls && no payments`.
       - Update the observation text.
       - In `security/evidence/results.json`, recompute the counts from the tests array.
   - The reviewer's probe is `/home/claude/.review-t06b/grounding.probe.ts`. It was lost with the old workspace, so rebuild its cases from this list.
3. **T12, agent HTTP service.**
   - Branch `feat/t12-agent-http-service` at `dff134f`, pushed and committed.
   - The first review found one blocker, in a chat route the builder added beyond the ticket; that route has since been removed. The re-review was stopped before it finished, so it needs a fresh focused re-review. Check:
     - the internal `ownerChat({latestOwnerTurn})` seam
     - the 31/32-character token boundary tests
     - the `AGENT_HOST` 100.64.0.0/10 boundaries and octets over 255
     - the new `InvoiceOutcome.suspiciousText` (at most 20 passages of up to 400 characters, addresses hidden; check split and X-addresses, and bidi characters)
   - If approved, merge it. W5 needs it.

## Not started
T11 (mutation hardening, plus the T07 review follow-ups: parse `get_rules`, `find_supplier` and approval replies; use `LogFilter`), T13 (see the decision below), T14, T17, T06c (follow-ups from the T06b review).

## Decisions waiting on Cam
- **T13 re-scope:** build T13 as one OpenAI-compatible `POST /v1/chat/completions` adapter over `ownerChat`, so Open WebUI can talk to the guarded agent instead of the raw Ollama model and "Pay Karoo $30" works from Open WebUI? This replaces the spec's `/agent/chat` SSE plan. The design notes, including "never hide a settled payment behind an error", are in `issues/13-agent-chat-stream.md`.
- **Open WebUI gaps (Xhanti's workstream):** the image tag `:main` isn't pinned, `ENABLE_DIRECT_CONNECTIONS` isn't off (CVE-2025-64496), and web loading isn't off (CVE-2025-65958). The docs mention that `mcp_gateway` could expose payment tools to the UI, which must never happen.
- **Old Claude trailers on main** (T04, T05, T06, T09): removing them needs a force-push of `main`, so they've been left.

## Human to-dos
- In branch protection, require the `test`, `secrets` and `adversarial` checks.
- Turn on "Automatically delete head branches".
- Xhanti should confirm the SECRET-04 retirement in #24.
