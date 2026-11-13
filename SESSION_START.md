# Start a new Shucamoxa session

Paste the following into a new LLM session, or ask a repository-aware coding
assistant to read it. Provide repository/file access if the assistant lacks it.

> We are building Shucamoxa in the W3Node project, repository
> `Xhanti-mbasa/myrmidons-agentic-finance`.
>
> First read `AGENTS.md`, `docs/PRD.md`, `docs/TECHNICAL_SPEC.md`, and
> `docs/PROJECT_STATUS.md`. Inspect the current branch, latest relevant source
> and tests; the status file is a dated snapshot. Do not assume a feature is live
> because a schema, mock, SDK adapter or earlier chat says it exists.
>
> The product is autonomous invoice payments to approved suppliers in test RLUSD,
> under owner-controlled limits enforced outside the LLM. It needs a real XRPL
> Testnet success case and a blocked case. Keys stay outside the agent, and the
> agent cannot change policy, choose arbitrary destinations or approve itself.
>
> Preserve the shared contracts and the policy/payment/signing boundary. Flag
> conflicts between code and requirements explicitly. Do not connect the Python
> MCP gateway to the TypeScript backend API without checking their different
> contracts. Read the current blockers and identify which workstream my task
> belongs to before changing code.
>
> My task for this session is: [describe the concrete change here].
>
> Complete the task within the authorized scope, run relevant checks, and report
> the result, evidence, remaining gaps and next step. Update the status document
> when implementation or verified readiness changes. Do not invent access,
> integrations, credentials, live tests, completed payments or business decisions.

Reading this prompt does not grant access to GitHub, the model instance, wallets
or any external service. Use the access actually available in the new session.
