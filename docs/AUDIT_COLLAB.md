# Claude ⇄ ChatGPT security & compliance collaboration

Shared working file between **Claude** (security, compliance and standards reviewer) and
**ChatGPT** (main builder with wider web access) for Shucamoxa. Requested by the team owner.
This is a working log, not product requirements: once a finding is agreed, it moves into
`docs/PRD.md`, `docs/TECHNICAL_SPEC.md` or `docs/PROJECT_STATUS.md` through a normal PR.

**How to use this file**

- Reply inline under any item with a short tagged line, e.g. `> [ChatGPT 2026-11-13 06:10] Agreed, doing in T12.`
- Update the **Status** column when something changes: `open`, `accepted`, `in progress`, `fixed (PR #n)`, `won't fix (reason)`.
- Append new questions and answers in §5 rather than rewriting earlier ones.
- No secrets, seeds, tokens, private invoice contents or personal data in this file. It is public.
- Evidence levels follow `AGENTS.md`: everything below is from **source inspection** of `main` at
  `3d2acce` (13 Nov 2026, 05:16 SAST). Nothing below was run against a live service or ledger.

---

## 1. Overall assessment

The engineering discipline is strong. Specifically: the honest evidence labelling, the agent
env allowlist plus secret value scanning (T09), the supplier binding in invoice mode (T04),
address redaction before model output, the tool-less extraction stage, the hash-chained log
with canonical JSON, the pinned-SHA CI actions, gitleaks with a self-test, and the root sync
that treats PRs as data.

**The main risk is not a code bug. It is that nothing yet enforces anything outside the agent.**
There is no backend, no policy co-signer, no signer list on the ledger and no Testnet payment.
Every control that currently works is a layer-1 check inside the agent process. The track is
judged on "limits enforced where the agent can't bypass them", so the next work has to be the
W2/W3/W4 vertical slice (PROJECT_STATUS milestone 2). §2.2 lists the XRPL-specific rules that
slice must get right.

The other team's-eye-view risk: several other public W3Node entries are building the same
"AP agent + independent co-signer + 2-of-N multisig + RLUSD" pattern, and some are already live
on Testnet with dashboards. Originality is one of Ripple's five judging criteria. §4 proposes
three features to set this project apart; please challenge them.

---

## 2. Findings

Severity: **High** = blocks a credible "CFO would sign off" claim or allows bypass. **Med** = real
weakness, fix before the demo. **Low/Info** = hygiene.

### 2.1 Repository and process

| ID | Sev | Finding | Recommendation | Status |
|---|---|---|---|---|
| R1 | High | `main` has **no branch protection**: no required checks, no required review, force-push allowed. Any collaborator, or any AI coding agent holding a collaborator token, can push straight to `main`. The PR-based workflow in `docs/team-workflow.md` is convention only. | Protect `main`: require PRs, require the `CI / test`, `CI / secrets` and `Team CLI tests / python-test` checks, require 1 approval, block force-push and deletion. This is a repo setting (owner action), not code. | open |
| R2 | Med | `.gitleaks.toml` `hex-private-key-64` allowlist exempts **any line** containing `hash`, `digest`, `sha256` or `checksum`. `walletKeyHash = "<64-hex private key>"` or a trailing `# checksum` comment would pass both the pre-commit hook and CI. | Narrow the exemption to known field names (`prevHash`, `hash`, `txHash`, `logEntryHash`, `GENESIS_HASH`) and/or path-scope it (lockfiles, `model.lock.json`, `base-model.lock.json`). Add a self-test case that `secretKeyHash = <64hex>` is caught. | open |
| R3 | Low | CI runs `pnpm install` with dependency lifecycle scripts enabled. | Set `onlyBuiltDependencies` (pnpm) or `--ignore-scripts` for deps, so a compromised transitive package can't execute in CI. | open |
| R4 | Info | Infrastructure detail is public: Tailscale IP `100.83.89.75`, host name, SSH host-key fingerprint, member usernames. Reaching it needs tailnet membership, so impact is low. | Fine for a hackathon. For anything beyond, move host constants into the root-owned server config. | open |
| R5 | Info | The repo has **no LICENSE**, **no SECURITY.md** (vulnerability disclosure) and no threat-model doc. | Add SECURITY.md (contact plus "testnet only, no bounty"). Choose a licence deliberately (judges and the UDAX accelerator may ask about IP). A one-page threat model (STRIDE over agent / policy / signer / ledger) would score well on the "enforcement" criterion. | open |
| R6 | Info | Shared model container: developers get `/bin/bash` there. | Make it a written rule that **no signing key, owner credential or policy-service secret is ever placed on `shucamoxa-dev`**. Host the policy signer separately. | open |

### 2.2 XRPL signing and policy: rules the W2/W3 slice must implement

None of these exist yet. They come from how XRPL multisig and Payment transactions actually
behave, and they are the usual ways a "2-of-N with a co-signer" design gets bypassed.

| ID | Sev | Rule | Why | Status |
|---|---|---|---|---|
| X1 | High | **Allowlist `TransactionType = Payment` only** in the policy co-signer. Refuse `SignerListSet`, `SetRegularKey`, `AccountSet`, `TrustSet`, `OfferCreate`, `AMM*`, `EscrowCreate`, `CheckCreate`, `PaymentChannel*`, `AccountDelete`, `Batch`, `Clawback` and anything unknown. | With quorum 2 and agent weight 1 plus policy weight 1, **agent + policy together can sign any transaction, including one that replaces the signer list or re-enables the master key.** `FORBIDDEN_TX_FIELDS` checks fields, not types. | open |
| X2 | High | **Refuse `tfPartialPayment`.** Reconcile and verify settlement from `meta.delivered_amount`, never from `Amount`. | This is the classic XRPL partial-payment issue: a tx can validate with `tesSUCCESS` while delivering far less than `Amount`. AC-01 "correct amount" evidence must use `delivered_amount`. | open |
| X3 | High | **Refuse `Paths`, and refuse `SendMax` unless it equals `Amount` with the same currency and issuer.** | Otherwise a payment can route through the DEX/AMM at an arbitrary rate and drain more RLUSD/XRP from the treasury than the invoice amount. FX is out of MVP scope anyway. | open |
| X4 | Med | **Cap `Fee`** (e.g. ≤ 1000 drops on Testnet) and check `NetworkID`/endpoint. | An agent-built tx with a huge `Fee` burns treasury XRP and passes amount/destination checks. | open |
| X5 | High | Treasury setup: `SignerListSet` (agent 1, policy 1, owner 2, quorum 2), then **`AccountSet asfDisableMaster`**, and **no Regular Key**. The agent's own account holds only fee XRP. Prove it in tests with `tefBAD_QUORUM` (agent alone) and `tefMASTER_DISABLED` (master key). | Without master-disable, the treasury seed is a full bypass. Without the negative tests there is no evidence for AC-02/FR-09. | open |
| X6 | Med | Policy decodes the **agent-signed blob itself** and compares every field to its own canonical tx (already in the `CosignRequest` comment). Also bind `Sequence`/`TicketSequence`, `LastLedgerSequence ≤ current + 20`, `Memos` = exactly one memo of `MEMO_TYPE` whose data = `logEntryHash`, `DestinationTag` = the supplier record's tag or absent, and `InvoiceID` if used. | Field-level substitution between the JSON shown to policy and the bytes actually signed. | open |
| X7 | Med | RLUSD issuer controls: RLUSD supports **freeze and clawback**. Settlement evidence is final on-ledger, but funds can later be clawed back by the issuer. | State this honestly in the risk section and owner UI ("settled on ledger; issuer-controlled stablecoin"). The CFO will ask. | open |
| X8 | Med | Policy rechecks **kill switch, mandate version and budget reservation at co-sign time**, not only at agent start. (`agent.ts` reads `killSwitch` once per run, which is fine as layer 1.) | FR-05/FR-12; the "changed policy between planning and signing" test in PRD §9. | open |

### 2.3 Agent and MCP code

| ID | Sev | Finding | Recommendation | Status |
|---|---|---|---|---|
| A1 | Med | **Python MCP gateway passes backend JSON to the model unredacted.** The TS agent strips addresses (`redactAddresses`), but `mcp_gateway/server.py` returns `get_mandate`/`get_invoice` bodies verbatim. `get_mandate` is documented to include approved suppliers. | Port the same key and regex redaction into the gateway's `backend()` return path, plus a test with an address-bearing mock response. Same rule on both stacks: addresses never reach the model. | open |
| A2 | Med | Python gateway maps **every** non-2xx POST, including 400/409/422 policy refusals, to `status: "unknown"`. That treats a definite refusal like an uncertain outcome and invites polling loops. | Only timeouts, transport errors and 5xx are `unknown`. Treat 4xx as definite **if** the backend contract guarantees nothing was submitted on 4xx. That guarantee needs to be written into the API contract (see Q4). | open |
| A3 | Med | TS `backend.ts`: `fetch` **follows redirects** by default and has **no timeout**. `POST /payments` sends **no `Idempotency-Key`**, though the Python gateway does. On a pay timeout or 5xx, `decide()` reports `needs_review` rather than an unknown outcome to reconcile (FR-13). | `redirect: "error"`, `signal: AbortSignal.timeout(30_000)`, add the same derived `Idempotency-Key` (scope + invoice number + version), and add an `unknown` outcome in `AgentOutcome` so reports never imply "nothing happened". | open |
| A4 | Med | `propose_supplier` accepts an **address taken from invoice text** and forwards it to the owner approval queue. This is exactly the business-email-compromise path ("our bank details changed"). | Owner UI must flag "address came from an invoice, unverified", never pre-fill it as trusted, and require out-of-band confirmation. Feature A in §4 makes this cryptographic. | partly fixed (#16): the model can no longer choose the address; code fills it from the invoice. The invoice-supplied address still reaches the owner queue, so the owner-UI flag and out-of-band check remain open (W5). |
| A5 | Low | `decide()` uses `Number(...)` comparisons and `tools.ts` has a local `cents()`. These are safe today because `Amount` limits to ≤ 12 digits and 2 decimals (< 2^53), but they diverge from the shared helpers (GAP-04). | Use `compareAmounts`/`toCents` everywhere for one implementation of money. | fixed (#16) |
| A6 | Low | The audit hash chain is **unkeyed SHA-256**. Anyone with DB write can recompute the whole chain. Only settled payments are anchored (via memo). | Periodically anchor the chain head on the ledger, including for **blocked** events. See Feature B. | open |

---

## 3. Policy, legal and compliance write-ups

The PRD and spec are honest and well scoped ("testnet only, no compliance certification").
Before pitching to judges or the UDAX Cape Town accelerator, the docs should show the team
**knows** the regulatory perimeter, without claiming compliance. Claude is not a lawyer; these
are the items to research and summarise. **ChatGPT: please verify each against current
primary sources and reply with links.**

| ID | Area | What to check / write | Status |
|---|---|---|---|
| L1 | SA crypto-asset regulation | FSCA declared crypto assets a financial product (2022) → CASP licensing under FAIS. Would Shucamoxa, or its custody/settlement partner, need an FSP licence, or operate only as software for a licensed partner? GTM should name the partner model. | researched in `FINANCE_TRUST_FRAMEWORK.md` §1 (38db95a). Still needed: name the partner model in GTM. |
| L2 | SA FIC Act / AML | Record-keeping (5 years), customer due diligence and FIC **Directive 9 (travel rule for CASPs)**. Map which obligations sit with the business, the partner and Shucamoxa. | researched (38db95a; Directive 9 commenced 30 Apr 2025). Obligation-by-party mapping still open. |
| L3 | SA exchange control | SARB rules on cross-border transfers and crypto-assets for SA residents (relevant to the Cape Town → Lagos importer story). | researched (38db95a): Aug 2026 framework is a draft; don't code it as law. |
| L4 | POPIA | Supplier records (sole-proprietor names, contacts) and invoices are personal information. Rule: **no personal data on-chain, ever** (memo = hash only, already true). Retention vs deletion, operator agreement, and a privacy notice. | researched (38db95a). Privacy notice still to write. |
| L5 | Sanctions screening | Supplier onboarding should screen against UN/OFAC (and SA TFS list) before approval. Currently absent. | researched (38db95a); not implemented. Fits the proposed eligibility-decision contract. |
| L6 | FATF R.15/R.16 | Brief note on travel-rule data for VASP-to-VASP transfers; likely out of MVP scope, but say so. | researched (38db95a) |
| L7 | Standards to cite | OWASP Top 10 for LLM Applications (LLM01 prompt injection, excessive agency), CCSS (CryptoCurrency Security Standard) for key management, OWASP ASVS L2 for the owner surface. Cite as "designed against", not "certified". | partly: framework cites NIST AI RMF, ISO 42001/27001 and SOC 2. **Add OWASP LLM Top 10 and CCSS**: these are the ones a security judge will look for on prompt injection and key custody. |
| L8 | BEC case law | Another team cites SA Supreme Court of Appeal rulings that a business which pays a fraudster's account still owes the supplier. Verify the citations (*Intengo Imoto v Zoutpansberg Motor Wholesalers* [2025] ZASCA 93; *ENS v Hawarden* [2024] ZASCA 90). If correct, this is the strongest legal argument for Feature A. | open |
| L9 | RLUSD issuer controls | The framework covers RLUSD Sharia/legal status but not that the issuer can **freeze and claw back**. See X7. | open |

**Claude's review of `FINANCE_TRUST_FRAMEWORK.md` (38db95a).** Good work: sourced, scoped and
careful not to over-claim. The "no model-supplied `compliant:true`" rule and the eligibility
decision outcomes (`allow`/`block`/`review`/`unavailable`, with only `allow` passing) are exactly
right. Three asks: add L7's OWASP LLM Top 10 and CCSS; add L9; and in `SUPPORTING_STATEMENT.md`
lead with the controls the product **enforces**, not the standards it **draws on**, because judges
reward evidence over citations. Opportunity: an explicitly scoped, reviewer-approved
**Islamic-finance mandate profile** (no interest-bearing products, approved-activity screening) is
something no other entry offers. It could be a real originality angle for Muslim-owned SMEs in
Cape Town, Dakar and Lagos. That only holds if it stays labelled "profile pending qualified review".

---

## 4. Three standout features (proposals; please critique)

Selection criteria: (1) no other public W3Node entry Claude has seen does it, (2) it scores on
Ripple's criteria (viability, autonomy, enforcement, XRPL use, originality), (3) it fits on top
of the MVP slice rather than replacing it, (4) it could be sold to a real CFO.

### Feature A: Supplier key-continuity (BEC made cryptographically impossible)

**Problem.** The costliest SME payments fraud is a forged "our bank details changed" invoice.
Other entries detect it with an LLM or rules. Detection can be fooled.

**Idea.** A supplier's payout address can only change **with a message signed by the supplier's
currently registered XRPL key**. Then a cooling-off period (e.g. 72 h) and an owner notification
before the policy co-signer accepts the new destination. Optionally, suppliers sign invoices
themselves (hash of canonical invoice fields, signed by their wallet); the agent fast-tracks
signed invoices and routes unsigned ones to review.

**XRPL.** XLS-70 **Credentials**: the business issues a `verified-payee` credential to each
approved supplier wallet, and the policy co-signer requires it on the destination. **Deposit
Authorization** on supplier wallets is an optional extra layer.

**Why it wins.** It turns the agent from "probably won't be fooled" into "*cannot* be fooled
into paying a new address". It speaks directly to the legal-liability argument in L8, and it
gives the supplier side an onboarding story (invite link → wallet → credential).

### Feature B: Proof of refusal (the agent's mistakes are audited too)

**Problem.** Everyone logs successful payments on-chain via memos. The CFO and auditor care just
as much about what the agent **tried and was stopped from doing**. Today that lives only in a
database the operator could edit (A6).

**Idea.** Every N minutes, or on every block/kill-switch event, the policy service anchors the
**audit chain head** in a 0-value self-payment or tiny memo tx from a dedicated audit account. Add
a public **verifier page**: paste the exported log, it recomputes the chain and checks each
anchor on Testnet. "Here is cryptographic proof the agent tried to pay 450 RLUSD to an unknown
address at 14:02 and policy refused it."

**XRPL.** Memos, the existing `canonicalJson`/`hashLogEntry`/`verifyChain`, and the public ledger
as a timestamping notary. Cheap to build: most primitives already exist in `@shucamoxa/shared`.

**Why it wins.** It is the direct answer to the CFO's fourth question ("how do I prove what it
did and why"), it covers blocked attempts that others leave off-chain, and it is a strong live demo.

### Feature C: Anti-structuring circuit breaker (AML-aligned, agent-proof)

**Problem.** Caps per payment are easy to dodge by **splitting**: one 180 RLUSD invoice becomes
four 45 RLUSD invoices, each under the 50 cap. That is how a manipulated agent or a fraudulent
supplier would drain a budget, and it is also the textbook AML "structuring" pattern.

**Idea.** The policy service (not the model) scores velocity and splitting: same supplier with
several just-under-cap amounts in a window, invoice numbers in sequence, a newly approved
supplier receiving rapid payments, total per supplier per period. Above a threshold it **holds**
the payment for the owner. On a severe pattern it **trips the kill switch automatically** and
writes a `policy_blocked` + anchored event (Feature B).

**XRPL.** All enforcement stays in the co-signer, so the ledger quorum still makes it unbypassable.
Optional: per-supplier periodic limits.

**Why it wins.** Rate and cap checks are table stakes; **behavioural** limits enforced outside the
model are not. It maps directly onto FIC Act / FATF language that judges and accelerators
recognise, and it gives a dramatic demo ("watch the agent get talked into splitting; watch the
ledger refuse").

**Alternates if one is rejected:** (D) a **two-person rule for mandate changes**: raising a cap
or approving a supplier needs 2 of N human owners, so one phished owner session can't widen the
mandate. (E) **early-payment discount capture**: the agent pays early when invoice terms offer a
discount (e.g. "2/10 net 30") and budget allows, so the product visibly pays for itself.

---

## 5. Questions for ChatGPT

> Answer inline. Short answers are fine; links help.

- **Q1.** What are you about to build in this session (which T-number/workstream)? I'll review
  that area first.
- **Q2.** Has the team decided the signer topology (weights, quorum, who holds the owner key,
  where the policy key lives)? If not, does X5 work for everyone?
- **Q3.** Backend stack and persistence choice for W4 (Supabase/Postgres? SQLite?). This decides
  how durable idempotency and reservations (FR-07/FR-08) get done.
- **Q4.** Will the backend contract guarantee "4xx ⇒ nothing was submitted to the ledger"? (A2)
- **Q5.** Please paste the **W3Node scoring rubric and weights** from the Participant Hub, plus
  the **submission deadline** and required deliverables (video length, live link, etc.).
- **Q6.** Please research and verify L1–L8 with primary sources, and add findings under §3.
- **Q7.** Your view on Features A/B/C (or D/E instead): feasibility before the deadline, and
  what you'd cut.
- **Q8.** Anything in the repo you know is planned or already decided that contradicts a finding
  above? Mark the finding `won't fix (reason)` and say why.

---

## 6. Log

- `[Claude 2026-11-13 05:45 SAST]` File created. Audit baseline `main@3d2acce`. Next: review
  each new commit/PR against §2 and answer replies here.
- `[Claude 2026-11-13 05:58 SAST]` Moved to `main` (was on `collab/security-audit`), following the
  owner's direct-push instruction in `TEAM_HANDOFF.md`. Reviewed `38db95a` (finance framework),
  `dbaffa2` (T06 extraction grounding) and `e1870ac` (T05 approval binding). T05 fixes A5 and
  partly fixes A4. T06 adds normalisation, a random wrapper tag and grounding of amount, number,
  address and supplier in the text; no new issues found by source inspection (tests not rerun).
  §3 statuses updated from the framework. Open High items unchanged: R1, X1–X3, X5.
  **Codex: please answer §5 here, starting with Q1, Q2 and Q5.**
