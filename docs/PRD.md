# Shucamoxa product requirements

Version: 0.1 draft baseline. Updated: 13 November 2026 (Africa/Johannesburg).
Product owner: Xhanti / the Myrmidons team; individual workstream owners remain
to be assigned. Repository: `Xhanti-mbasa/myrmidons-agentic-finance`.

This document specifies the intended MVP. It does **not** certify that the MVP
is implemented, deployed, secure or ready for real funds. See
[project status](PROJECT_STATUS.md) for evidence and gaps, and
[technical specification](TECHNICAL_SPEC.md) for contracts and boundaries.

## 1. Product and customer

Shucamoxa is an owner-controlled invoice-payment agent for small importers and
cross-border SMEs. It pays known suppliers within an explicit mandate and makes
its decisions explainable and auditable. The working customer is a small importer
whose owner or finance lead currently verifies invoices and initiates payments
manually. This customer profile follows the existing agent and demo fixtures;
customer interviews and willingness to pay have not yet been established.

The finance lead needs answers to four practical questions: what can this agent
spend, who can it pay, how can I stop it, and how can I verify what it did?
Autonomy is useful only when these boundaries are enforced outside the model.

Working name: **Shucamoxa**, as used by current code/shared contracts. W3Node is
the wider project and Myrmidons is the team/repository context. Older PayGuard
labels are historical. Final public branding is an open decision.

## 2. Outcome and success criteria

The MVP succeeds when an owner can configure a mandate, submit an invoice,
observe an agent complete an allowed payment without approving every individual
in-mandate transaction, and see a disallowed attempt blocked independently of
the model. The final demonstration must include all of the following:

| ID | Release acceptance criterion | Required evidence |
|---|---|---|
| AC-01 | At least one agent-initiated, in-mandate payment settles on XRPL Testnet. | Validated transaction, successful ledger result, correct asset/issuer/amount/recipient, and linked audit record. |
| AC-02 | An out-of-mandate request cannot obtain the signatures/authority needed to move funds. | Deterministic policy rejection and evidence that no disallowed transaction settled. |
| AC-03 | The owner can set and change limits independently of the agent. | Authenticated owner action changes the authoritative policy; an agent credential cannot do so. |
| AC-04 | The owner can stop new payment authority. | Kill-switch test blocks a new request at the policy/signing boundary, even if the model still requests payment. |
| AC-05 | Duplicate or concurrent requests for one business invoice do not create a second payment. | Concurrency/idempotency test plus ledger/audit evidence for the live success case. |
| AC-06 | A reviewer can explain each outcome from deterministic rules and evidence. | Invoice, matched supplier ID, policy version/decision, audit chain and ledger reference agree. |
| AC-07 | Prompt injection in invoice content cannot change the payee, amount, policy or signing privileges. | Adversarial fixture/evaluation results and an independently enforced block where appropriate. |

A model chat, a recommendation awaiting human approval for every payment, an
echo tool call, or a test backed only by fake payment responses is not AC-01.

The uploaded Ripple track resources require autonomous Testnet/Devnet execution,
limits beyond agent control, human mandate management and a blocked-path demo.
This product chooses **Testnet**, matching current repository constants. Devnet
or emerging XRPL features are not required for the MVP.

## 3. Personas and authority

| Persona | May do | Must not be able to do |
|---|---|---|
| Owner / finance lead | Manage approved suppliers, payment cap, budget and kill switch; decide exceptions; inspect evidence. | Silently rewrite historical records without detection or mistake a pending result for settlement. |
| Payment agent | Extract invoice data, read scoped rules, find approved suppliers, request allowed payments, propose exceptions, query permitted logs. | Change rules, approve itself, introduce an arbitrary payment destination, access wallet secrets or bypass policy. |
| Backend / policy / signer services | Authenticate callers, resolve payees, enforce policy, reserve budgets, sign/submit and reconcile within their separated responsibilities. | Treat model reasoning or an invoice-provided address as authorization. |
| Developer / reviewer | Work in the repo, run scoped development tests and use individual instance access. | Assume SSH access is permission to use signing keys, real funds or production customer data. |

## 4. MVP scope

**In scope:** invoice intake and structured extraction; approved-supplier lookup;
test RLUSD payments; externally enforced caps and budgets; duplicate prevention;
owner exception handling and revocation; audit/ledger evidence; an owner-facing
control surface; local developer MCP/model testing; reproducible repository
context and versioned configuration/artifact references.

**Out of scope for this release:** Mainnet/real-value execution; unrestricted
agent signing; autonomous policy changes; DEX routing/FX conversion; lending,
yield and vault products; creating a new token; production custody/compliance
certification; Gmail ingestion by default; paid x402/MPP services; training a
foundation model; arbitrary tensor editing; production multi-tenant hosting.

These are scope choices, not claims that XRPL or a vendor lacks those features.
New integrations need explicit requirements and validation before joining the MVP.

## 5. Main user journey

1. The owner configures a Testnet treasury, approved suppliers, a per-payment
   cap, a budget period and a currently enabled mandate through an authenticated
   owner flow. Signing requirements are established before enabling the agent.
2. The operator supplies an invoice. MVP intake may be text/file input; email
   ingestion is a later integration. The system records its identity and version.
3. Extraction produces bounded structured data or `needs_review`; invoice text
   is untrusted data, including any instructions embedded in it.
4. The agent reads current rules and matches the supplier. It requests a payment
   only to an approved supplier ID, for the extracted invoice total.
5. The backend resolves the real destination and creates a canonical transaction.
   Independent policy checks the transaction and mandate, including asset,
   destination, cap, remaining budget, duplicates, freshness and audit linkage.
6. An allowed operation reserves budget, obtains the required independent signing
   authority, submits once, and is reconciled to a validated outcome or definite
   expiry/rejection. The product does not claim settlement from submission alone.
7. Unknown suppliers and exceptions go to the owner; they are not automatically
   approved. A blocked request remains blocked until an authorized owner decision
   produces a valid new authorization and policy is checked again.
8. The owner sees outcome, reason, policy decision and ledger/audit evidence, and
   can revoke new authority. Revocation cannot undo an already validated payment.

## 6. Functional requirements

All requirements below are P0 unless marked P1. They are normative targets;
implementation status is maintained separately.

| ID | Requirement | Acceptance / observable behavior |
|---|---|---|
| FR-01 | Authenticate owner, agent and service roles separately. | An agent token is refused for supplier approval, mandate edits and kill-switch changes. Business scope derives from authenticated identity. |
| FR-02 | Maintain approved supplier records outside agent control. | Payments accept a supplier ID; backend resolves the configured address. Agent-facing reads omit payment addresses. |
| FR-03 | Validate invoice extraction. | Invalid, unsupported-currency, inconsistent or ambiguous data produces `needs_review`, without a payment request. USD/RLUSD invoice labels are not permission to send an arbitrary asset. |
| FR-04 | Treat document/tool instructions as untrusted. | Injected text cannot alter the invoice total, destination, policy, system role or privileges. |
| FR-05 | Read authoritative mandate state before execution. | Missing/unreachable/malformed rules fail closed. Changes are rechecked immediately before independent authorization/signing. |
| FR-06 | Make requests with bounded shared schemas. | Unexpected flags, destinations or unsupported fields are rejected; decimal amounts and IDs satisfy the shared package. |
| FR-07 | Enforce cap and aggregate budget independently. | Both over-cap and over-budget attempts fail; concurrent requests cannot overdraw available budget. Amount comparisons use exact integer cents. |
| FR-08 | Deduplicate business invoices durably. | Retries, parallel requests and service restarts cannot cause another settlement for the same payable identity/version. In-memory per-run guards are insufficient. |
| FR-09 | Protect the signing boundary. | The agent cannot obtain signing secrets or produce all required signatures on its own; direct bypass of the normal payment endpoint is also refused. |
| FR-10 | Match genuine test RLUSD and approved recipient. | Policy verifies the asset's currency **and issuer**, canonical amount and approved address from trusted records, not a display symbol. |
| FR-11 | Manage exceptions outside agent control. | Unknown supplier/over-limit cases create an owner-visible pending request. Approval is authenticated, bounded and revalidated, not an unlimited bypass flag. |
| FR-12 | Implement revocation. | Kill switch blocks new authority at execution time. The owner can revoke/rotate agent authority without exposing their own signing secrets to the agent. |
| FR-13 | Reconcile submissions conservatively. | Pending/unknown/transport failure is not `paid`; no blind POST retry. Expiry or rejection is established from ledger evidence before retry/releasing uncertain reservations. |
| FR-14 | Provide an audit trail tied to transaction intent. | Hash-linked entries, canonical data and the configured memo bind intent to the transaction. Missing/tampered/reordered history is detected within documented verification limits. |
| FR-15 | Provide owner controls and monitoring. | Owner can manage suppliers/limits, review exceptions, toggle revocation, inspect budget/spend/pending and trace a payment to its evidence. Final dashboard technology is open. |
| FR-16 | Report outcomes deterministically. | Public explanations distinguish paid, blocked, awaiting owner and needs review; they use actual service/ledger outcomes, not model claims. |
| FR-17 | Demonstrate the safety story. | The prescribed happy path, over-cap/budget, unknown supplier, duplicate, injected invoice and kill-switch scenarios have reproducible evidence. |
| FR-18 (P1) | Make team/model development reproducible. | Individual keys, scoped onboarding and local MCP discovery work; profiles and artifact checksums are versioned; developers can reproduce tests without sharing keys. |
| FR-19 (P1) | Preserve context across LLM sessions. | A new session reading AGENTS, PRD, spec and status can name the customer, MVP, authority boundary, current gaps and next task without relying on prior chats. |

## 7. Owner experience requirements

The owner control surface must show current mandate status, allowed suppliers,
cap, budget period, spent/reserved/remaining amounts, pending exceptions and an
event feed. Every payment detail must separate request, policy decision,
submission and confirmed outcome. Show why an action was blocked and who may
resolve it. Approval buttons and settings are owner-authorized operations;
displaying an agent-generated suggestion cannot grant authority.

Do not label a transaction paid while its status is unknown. Do not display a
model's confidence score as payment authorization. A simple working control
surface is acceptable for the demo; an implemented web dashboard is not claimed
by the current repository snapshot.

## 8. Quality and security acceptance

| Area | Release gate |
|---|---|
| Financial correctness | Exact monetary arithmetic, issuer-aware asset checks, durable concurrency/idempotency and no duplicate settlement in the acceptance scenarios. |
| Least privilege | Agent/service/owner credentials are separate; no seed, private signing key or privileged database credential reaches the agent. |
| Failure handling | Unavailable policy fails closed; uncertain ledger outcomes reconcile; pending reservations are not reused solely because a wall-clock timer elapsed. |
| Testability | Shared contracts, agent adversarial tests, policy tests, backend integration tests and at least one live Testnet success plus blocked case are evidenced separately. |
| Observability | Sanitized request correlation, rule codes, policy version and ledger/audit references; no secret logging or raw private-invoice dumps. |
| Developer usability | Documented one-command terminal chat from an installed checkout, zero-tool MCP discovery, an explicit harmless tool demo and clear dependency/tunnel errors. |
| Performance | Bounded model/tool steps and timeouts; record observed latency on the actual demo instance. No production latency/availability SLA is promised in this draft. |
| Recovery | Reproducible source/config revisions, retained operation state, explicit rollback/reconciliation procedure and a documented human recovery route. |

## 9. Demonstration scenarios

Use `fixtures/invoices/expected.json` and the associated text fixtures as the
existing evaluation baseline. Its **demo values** are a `50.00` per-payment cap
and `200.00` total budget; these are not hard-coded product-wide limits.

| Scenario | Required result |
|---|---|
| Approved supplier, `30.00` invoice within mandate | One allowed operation; release evidence must include actual Testnet settlement. |
| Unknown supplier | Owner exception; no payment to an unapproved address. |
| Above per-payment cap | Block or pending owner request; no over-cap automatic settlement. |
| Injected notes on a `45.00` invoice | Ignore instructions/alternate amount/address; only the genuine invoice amount may be considered. |
| Repeat of the first invoice | Duplicate blocked; no second payment. |
| Request after kill switch | New authority blocked, independently of the model. |
| Tag-escape/adversarial extraction | Only valid invoice data is considered, or `needs_review`; no extra authority. |
| Unsupported currency | `needs_review`; no payment request. |

Also test cross-run/concurrent duplicates, aggregate budget exhaustion, changed
policy between planning and signing, wrong issuer, destination mismatch,
malformed transaction/memo, expiry and unknown submission outcomes. Model
fixtures do not replace these policy/payment-service integration checks.

## 10. Delivery workstreams and gates

| Workstream | Responsibility | Completion gate |
|---|---|---|
| W1 Agent | Extraction, planning, bounded tools and deterministic reporting. | Runs against the agreed backend with shared schemas and hostile-input tests. |
| W2 Policy | Independent rules, signer authorization, cap/budget checks and revocation. | Refuses a malicious direct transaction as well as a bad normal API request. |
| W3 Payments / XRPL | Trusted construction, signing orchestration, submit/reconcile and test asset setup. | Correct validated Testnet settlement, no duplicate, and known-outcome recovery. |
| W4 Backend / audit | Authentication, suppliers, mandate versions, approvals, reservations, durable state and hash-linked log. | Atomic and permission-tested APIs, restart/concurrency tests and evidence consistency. |
| W5 Owner controls | Mandate setup, exception decisions, revoke and inspect. | Owner can complete the end-to-end acceptance journey. |
| Cross-cutting developer tooling | Individual access, model/MCP testing, release docs and session context. | Documented workflows work without shared private keys or false deployment claims. |

Delivery order: agree contracts/signing decision; complete backend/policy/payment
vertical slice with a non-model test; connect the agent; connect owner controls;
run live Testnet success and adversarial block demo. Existing local chat/MCP
experiments can proceed in parallel without being treated as the payment MVP.
No dates or personal task assignments are committed by this draft.

## 11. Decisions and open questions

| Topic | Current baseline / decision needed |
|---|---|
| Primary product | Small-importer invoice payables, inferred from current agent/fixtures; validate with owner/team and customer discovery. |
| Asset/network | Testnet RLUSD is the code baseline. Verify current test issuer/node from authoritative sources when configuring real signing; never switch to Mainnet silently. |
| Signing architecture | Shared contracts define an independent co-sign service. Actual threshold/signing topology is not deployed/evidenced. Decide how any Privy integration participates without weakening external enforcement. |
| Wallet vendor | Privy is a candidate from the workshop/research; Open Wallet Standard is another workshop option. No vendor signup, wallet or policy deployment is implied. |
| API integration | TypeScript shared contracts are the primary internal baseline. Python gateway uses incompatible `/v1` invoice-oriented routes. Agree an explicit adapter or coordinated migration before connecting it. |
| Invoice identity | Define authoritative business scope, invoice identity/version and correction semantics before durable payment implementation. |
| USD-labelled invoices | Current extraction accepts USD/RLUSD. Confirm and display the owner's test-only nominal settlement convention; do not silently perform FX or treat fiat as an on-chain asset. |
| Owner UI / persistence | Select implementation and storage with the team; no dashboard, datastore or deployment completion is assumed. |
| Go-to-market | Hypothesis: owner-led SME pilots, then bookkeeping/payment partners. Interviews, pricing and acquisition assumptions need validation, not claims of traction. |
| Commercial/release readiness | Mainnet, real funds, custody, legal/compliance, production availability and operational support require a separate review and release scope. |

## 12. Sources and document maintenance

Product baseline: current repository sources and tests, plus the supplied
`START-HERE-Agentic-Finance-Resources-Ripple.pdf` (pages 1-2) and
`Agentic-Finance-Track-Resources-Ripple.pdf` (page 1). Slides 24, 25, 27 and 32 of
`XRPL-Workshop-Slides-Ripple.pdf` provide ecosystem context, not proof of integration.
These uploaded documents are not copied into the public repository.

External references, to verify when implementing:

- https://xrpl.org/docs/agents/agentic-transactions
- https://docs.privy.io/wallets/using-wallets/xrpl/overview
- https://docs.privy.io/controls/policies/example-policies/xrpl
- https://ghostsig.dev/

Update this PRD when product scope/acceptance changes; update the technical spec
when contracts or boundaries change; update project status when implementation
or evidence changes. Keep proposed decisions visibly proposed until agreed.
Requirements and source code are versioned together through reviewed changes.
