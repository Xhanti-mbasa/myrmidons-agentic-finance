# Security scope and reporting

Shucamoxa is an experimental XRPL Testnet finance project. The default harness
uses simulated settlement. There is no production-support, certification or
real-funds security guarantee. Read SECURITY_ASSESSMENT.md and the current
security/evidence/results.json; historical totals and source implementations are
not deployment proof. Known vulnerabilities and missing controls remain open.

Do not submit seeds, keys, tokens, private invoices or customer information in
public issues, commits or screenshots. If private vulnerability reporting is
available on this repository's Security tab, use it. Otherwise contact a
maintainer through an already established private channel. If none is known,
open only a minimal public request for a private reporting channel, with no
sensitive exploit details. No bounty or response deadline is promised here.

A useful report identifies the commit, component, minimal synthetic reproduction,
expected/actual behavior and evidence level. Test only systems you own or are
authorized to test. No Mainnet funds, public-node load tests or attacks against
third-party model/payment providers are part of repository tests.

Signing credentials must stay outside model context, WebUI User Variables, Git
and logs. A transaction hash alone is not settlement; unknown outcomes require
reconciliation without creating a replacement payment identity. A local hash
chain cannot prove resistance to rollback or complete rewrite by its DB writer
without an independently retained authenticated checkpoint.

Repository protection rules and the project's licence are owner decisions; this
policy does not grant a software licence or claim those settings are configured.
