# Finance, Sharia governance and AI trust

Research date: 13 November 2026, Africa/Johannesburg.
Status: sourced design recommendations; not a licence, legal opinion, fatwa,
certification or evidence of deployed controls. Read alongside the PRD and spec.

## 1. What international finance law means here

There is no single worldwide financial licence or law that makes this application
compliant everywhere. Determine obligations from the operator's activities,
incorporation, customer locations, custody/signing arrangements, payment corridors
and relevant providers. A Testnet demonstration establishes none of these approvals.
The recommendations below assume a South Africa-linked prototype, not a decision
that South African law is the only applicable law.

| Reference | Classification | Consequence for this project |
|---|---|---|
| FATF virtual-asset recommendations [1] | International AML/CFT standards implemented through national systems, not an application licence. | Determine whether the operating business is a VASP/CASP; scope customer due diligence, beneficial ownership, monitoring, records and Travel Rule obligations. |
| South African FIC CASP scope and Directive 9 [2,3] | Local accountable-institution requirements where applicable. Directive 9 commenced 30 April 2025. | Assess whether transferring/controlling crypto for clients falls in scope; design verified originator/beneficiary data and secure off-chain exchange of required transfer information. |
| FSCA authorisation [4] | South African financial-services licensing regime. | Obtain an activity-specific assessment; software labels, decentralisation and a non-custodial interface do not by themselves decide the perimeter. |
| POPIA [5] | South African personal-information law. | Identify a lawful processing basis, minimise data, control access, assess cross-border transfers, retention and section 71 where qualifying automated profiling decisions are involved. Section 71 is not a blanket ban on automation. |
| SARB cross-border framework [6] | Exchange-control/capital-flow perimeter; the reviewed August 2026 announcement describes a draft. | Confirm the operative instruments for each intended corridor. This research did not establish that the draft had become final law. Do not code proposed limits as settled legal requirements. |
| Sanctions [7,8] | Binding obligations depend on jurisdiction and nexus. | Scope applicable South African/UN and other relevant regimes. OFAC guidance concerns persons subject to US jurisdiction; do not treat its list as the sole worldwide compliance test. |

The FIC's current compliance material includes risk management, screening,
monitoring, records and reporting [7]. A wallet address is not verified legal
identity. Name similarity is a candidate match, not a positive clearance or an
automatic criminal designation. Potential matches need documented resolution.
Where a legal freeze/report is required, an owner approval cannot override it.

Source conflict: an older SARB FAQ still says local crypto trading has no
regulatory requirements. That broad statement conflicts with newer specific
FSCA/FIC publications. Do not use it as a legal exemption. Have counsel reconcile
the actual operative instruments before real-money operation. Tax, consumer,
payment-service and other-country requirements also need activity-specific review;
this is a prioritised starting map, not an exhaustive jurisdictional opinion.

## 2. Islamic-finance policy baseline

Use AAOIFI for relevant contract/ethics/governance standards and IFSB for
institutional prudential/governance guidance [9,10]. Adoption and interpretation
vary by jurisdiction. IFSB-31, adopted in 2025, supplements rather than replaces
IFSB-10. These references do not certify this app or resolve every crypto ruling.

For this payment product, agency (Wakalah) is a candidate structure to evaluate,
not a concluded Sharia classification. AAOIFI's catalogue includes SS 23 Agency,
SS 18 Possession, SS 1 Trading in Currencies and SS 31 Gharar [9]. The catalogue
alone is not a clause-level implementation review. Qualified Sharia reviewers
must approve the actual contractual arrangement and applicable editions.

Recommended product policy, subject to that review:

| Policy | Implementable requirement |
|---|---|
| Explicit agency and consent | Record principal, authorised activities, payees, asset, caps, duration, revocation and disclosed fees. The agent cannot expand its own mandate. |
| Avoid riba-based services | Keep interest-bearing loans, overdrafts, automatic yield and interest-based late charges outside the payment MVP. Any later finance contract needs a separate review. |
| Limit excessive uncertainty and speculation | Make consideration, fees, recipient, asset and timing clear; exclude gambling products and unreviewed leveraged/speculative strategies. Ordinary technical uncertainty is not automatically a Sharia ruling of gharar [11]. |
| Approved underlying activity | Review merchant activity and payment purpose through accountable human processes. Do not infer a customer's religion from contacts, names or model output. |
| Asset and settlement review | Assess issuance, reserve arrangements, redemption rights, legal claim, fees, possession/control and any currency exchange. Do not equate dollar peg, regulatory status or ledger validation with Sharia approval. |
| Independent governance | Retain a qualified reviewer/board's decision, scope, conditions, effective dates, conflicts and review/exception process. The LLM cannot issue a binding fatwa or approve an exception. |

RLUSD is a project settlement candidate, not a Sharia-cleared asset established
by this research. Ripple's product materials describe jurisdiction-dependent
availability and reserve transparency [12]. Obtain the current issuer terms and
reserve disclosures for specialist review. Test RLUSD is a test asset; passing
a Testnet demo does not approve the live asset or its issuer arrangements.
Keep any Sharia policy profile explicitly scoped and versioned; do not silently
apply an unreviewed universal religious classification to every customer.

## 3. Earning trust in AI-assisted finance

Use NIST AI RMF 1.0 and its Generative AI Profile to organise risks, evidence,
accountability and change review [13]. ISO/IEC 42001 and ISO/IEC 27001 provide
AI-management and information-security management references [14,15]. SOC 2 is
an independent controls examination, not proof of error-free financial decisions
[16]. Basel operational-resilience principles are a useful bank-oriented design
reference, not automatically a statutory requirement for this prototype [17].

Our engineering recommendation is to treat model output as untrusted proposals
and make spending authority independently verifiable:

| Control | Required evidence before it is called implemented |
|---|---|
| Authenticated authority | User/mandate binds the exact source, approved recipient, asset, amount and timing. Owner and agent credentials cannot substitute for each other. |
| Trusted identity | Directory record links verified counterparty and wallet/tag, with provenance, expiry and ambiguity handling. Semantic search only retrieves candidates. |
| Independent policy and signing | Signer verifies exact transaction fields and current authority; bypassing MCP/HTTP cannot obtain unrestricted signing. |
| Exact execution | Decimal/integer money, strict schemas, parameterised SQL, issuer checks, no arbitrary destinations or model-generated executable code. |
| Durable recovery | Atomic reservations/idempotency; restart and concurrency tests; pending/unknown states reconcile without creating another payment. |
| External controls | Applicable screening and, if offered, approved Sharia profile are checked outside the model; stale, missing or inconclusive required evidence cannot clear payment. |
| Evidence and reconciliation | Audit links intent, policy version, decision, signing/submission identity and verified ledger result. Independent monitoring accounts for inbound and out-of-band activity. |
| Containment | Agent cannot write tool/policy code, read signer secrets or mutate authoritative payment state; deployment permissions and network restrictions demonstrate this. |
| Abuse and recourse | Scope rate limits/lockout to the offending authenticated authority; preserve owner recovery and a review route for mistaken matches or disputed decisions. |
| Model change assurance | Pin model/profile/tool versions; evaluate adversarial inputs and intent errors, test deterministically, review releases and retain rollback/evidence. |

A prompt-injection detector or confidence score is not a spending authorisation.
No finite test set proves an LLM never makes mistakes. The release claim should
describe tested controls and known residual risks, with accountable humans for
exceptions, incident response and legal/Sharia decisions.

## 4. Integration plan and honest release gates

This document adds no executable compliance engine and enables no Mainnet funds.
Inspect current source and status; earlier branches, tests and model claims are
not deployment evidence. In particular, do not assume the transfer core exists
on main until its actual files are present.

1. Establish the operating entity, activities, jurisdictions, custody model and
   regulated partners. Record counsel's applicability assessment and owner signoff.
2. If an Islamic-finance profile is offered, obtain a scoped specialist decision
   on the contract, asset, fees and screening criteria before advertising approval.
3. Agree a separately versioned eligibility decision contract with trusted
   evidence references, rule-set version, effective/expiry time and outcomes
   `allow`, `block`, `review` or `unavailable`. This is a proposed contract, not
   a new existing API. No model-supplied `compliant:true` flag is acceptable.
4. Bind the decision to the exact payment intent and recheck freshness and
   revocation at the final signing boundary. Neither review nor unavailable is
   allow. Separate owner exceptions from non-overridable legal prohibitions.
5. Test expired evidence, ambiguous identity, changed beneficiaries, unavailable
   screening, malicious documents, duplicate/restarted requests, policy changes,
   disabled authority and direct signer bypass. Attach actual Testnet evidence.
6. Release only after wallet/policy integration, independent review, recovery
   rehearsals, audit access/retention controls and applicable legal approvals.

Assign retention by data class and applicable law; do not log everything forever.
Keep personal identity documents, Travel Rule payloads and sensitive review
records off public blockchains, outside Git and outside model context. Audit
references/hashes support traceability but do not replace protected source records
or a legally adequate recordkeeping programme.

## Primary-source register

Official sources checked 13 November 2026. Full ISO/AAOIFI clause-level conformity
was not assessed from public summaries/catalogues. Recheck laws before launch.

1. FATF, virtual assets: https://www.fatf-gafi.org/en/topics/virtual-assets.html
2. FIC, CASP scope: https://www.fic.gov.za/accountable-institut/crypto-asset-service-providers/
3. FIC, Directive 9 and commencement: https://www.fic.gov.za/document/directive-9-travel-rule-relating-to-crypto-asset-transfers/ ; https://www.fic.gov.za/wp-content/uploads/2024/11/Media-release-FIC-publishes-Directive-9-relating-to-the-implementation-of-the-travel-rule-by-CASPs.pdf
4. FSCA, authorisation: https://www.fsca.co.za/New-Financial-Service-Provider/
5. Department of Justice, POPIA, including sections 71/72: https://www.justice.gov.za/legislation/acts/2013-004.pdf
6. SARB/Treasury, 3 August 2026 draft announcement: https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets
7. FIC, compliance obligations: https://www.fic.gov.za/compliance/
8. OFAC, jurisdiction and digital currency: https://ofac.treasury.gov/faqs/560
9. AAOIFI, Sharia and governance catalogues: https://aaoifi.com/shariah-standards-3/?lang=en ; https://aaoifi.com/issued-standards-2/?lang=en
10. IFSB, IFSB-31/IFSB-10 relationship: https://www.ifsb.org/press-releases/ifsb-council-adopts-new-standard-and-approves-the-issuance-of-a-guidance-note/
11. IFSB, prohibited-income context: https://www.ifsb.org/wp-content/uploads/2023/11/Compilation-Guide-on-PSIFIs-2007_En.pdf ; AAOIFI standards volume: https://aaoifi.com/download/24233/
12. Ripple, RLUSD product and terms: https://ripple.com/products/stablecoin/ ; https://ripple.com/legal/stablecoin/
13. NIST, AI RMF and GenAI Profile: https://www.nist.gov/itl/ai-risk-management-framework ; https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
14. ISO/IEC 42001: https://www.iso.org/standard/42001
15. ISO/IEC 27001: https://www.iso.org/standard/27001
16. AICPA, SOC resources: https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2
17. Basel Committee, operational resilience: https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20
