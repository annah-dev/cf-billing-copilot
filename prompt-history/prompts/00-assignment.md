## Goal

Build and deploy **cf-billing-copilot**, a small AI-powered billing assistant that runs entirely on Cloudflare. It is my optional assignment for Cloudflare's **Senior Director of Engineering, Billing Platform** application. The finished code goes in the public repo **https://github.com/annah-dev/cf-billing-copilot** (create it if it doesn't exist).

Reviewers are Cloudflare engineering leaders. The app should show senior billing-platform judgment (correctness, auditability, clean architecture), not just a chatbot. Aim for a working, deployed demo in about 4–6 hours of agent time. Keep it small and polished rather than broad and fragile.

## Cloudflare's required components (all four must be present and visible in the README)

1. **LLM**: Llama 3.3 on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` or the current Llama 3.3 model ID).
2. **Workflow / coordination**: Cloudflare Workflows and/or Durable Objects.
3. **User input via chat**: a chat UI served from Cloudflare (Pages, or static assets on the Worker).
4. **Memory or state**: per-customer state and conversation history persisted in a Durable Object (SQLite storage).

Cloudflare's notes: "AI-assisted coding is encouraged, but you have to submit prompt history." Their suggested starting points: https://agents.cloudflare.com/ and https://developers.cloudflare.com/agents/

**Before scaffolding, read the current Cloudflare Agents, Workers AI, Durable Objects and Workflows docs. Model IDs, template names and APIs may have changed. Prefer the Cloudflare Agents SDK (e.g. the `agents-starter` template via `npm create cloudflare@latest`) if it's still current.**

## Product concept

A copilot for a customer of a usage-based SaaS product (Cloudflare-style metered services) that answers billing questions accurately and can start a credit request that needs a human to approve it.

Core user stories:

1. **Explain my invoice**: "Why is my September bill $412.87?" gives a line-by-line explanation that ties back to usage, plan, tiers, credits and tax.
2. **What changed**: "Why did my bill go up 38% vs August?" gives a usage-delta breakdown by product and a plain-language summary.
3. **Plan simulation**: "What would I have paid on the Pro plan?" gives a deterministic re-rating of the same usage under a different plan, with the difference.
4. **Anomaly flag**: the copilot notices an unusual usage spike (for example a 5x jump in one meter over one day) and mentions it proactively.
5. **Credit request with human approval**: "I was double-charged, can I get a credit?" The copilot gathers the details and starts a **Workflow** that validates the claim against the ledger, creates a pending credit memo, **waits for an approver event** (e.g. `step.waitForEvent`), then applies or rejects it and records an audit entry. The approver gets a simple admin page/endpoint to approve or reject.
6. **Memory**: the copilot remembers the customer's account, prior questions and open credit requests across sessions.

## Non-negotiable design principles (the "billing leader" signal)

- **The LLM never does money math.** All rating, totals, proration, tiering, credits and tax are computed by deterministic TypeScript functions using **integer minor units (cents)**. The LLM only chooses tools and explains results. State this in the README.
- **Tool-calling architecture**: expose typed tools such as `getAccount`, `getInvoice`, `explainLineItem`, `compareInvoices`, `simulatePlan`, `detectAnomalies`, `startCreditRequest` and `getCreditRequestStatus`. Validate all tool inputs with a schema (e.g. zod).
- **Auditability**: every state change (credit requested, approved, rejected, applied) writes an append-only audit record with a timestamp, actor and reason. Show the audit trail in the UI.
- **Idempotency**: credit requests carry an idempotency key, so retrying never creates duplicate credits.
- **Grounding**: every answer that cites a number must come from a tool result. If data is missing, the copilot says so rather than guessing.
- **Synthetic data only**: generate a small fictional dataset (2–3 customers, 3 months of daily usage across ~4 meters, 2–3 plans with tiered pricing, one invoice per month, one duplicate charge seeded for the credit story, one usage spike seeded for the anomaly story). No real company, customer or personal data.
- **Security**: no secrets in the repo. Use `wrangler secret` and bindings. Add a simple shared-secret or token check on the approver endpoint and note in the README that it's demo-grade.
- **Cost**: stay within Cloudflare's free or low-cost tiers.

## Suggested architecture

- **Worker + Agents SDK**: a chat agent class (Durable Object) per customer that holds conversation history and account context in SQLite.
- **Billing engine module**: pure TypeScript functions (rating, invoice build, compare, simulate, anomaly detection) plus unit tests. No Cloudflare dependencies, so it's easy to test and review.
- **Ledger / data**: seeded into Durable Object SQLite or D1. Pick one, justify it in the README, and keep a single source of truth.
- **Workflow**: `CreditRequestWorkflow` (validate → create pending memo → wait for approval → apply/reject → audit).
- **UI**: minimal, clean chat page plus a small panel showing the current invoice, open credit requests and the audit trail. An `/admin` view lists pending approvals.

## Suggested multi-agent roles

- **Architect**: reads current Cloudflare docs, confirms the stack and APIs, writes `docs/ARCHITECTURE.md` (with a Mermaid diagram) and the task plan. Gates the other agents.
- **Billing-engine engineer**: data model, seed data, deterministic rating/compare/simulate/anomaly code, and unit tests (including tiers, proration and rounding edge cases).
- **Agent/Workflow engineer**: Agents SDK chat agent, tool wiring to Llama 3.3, Durable Object state, CreditRequestWorkflow with the human-approval wait.
- **Frontend engineer**: chat UI, invoice/audit side panel, admin approval view.
- **QA / evals**: a small scripted eval set (10–15 questions with expected numeric answers) that checks the copilot's answers against the billing engine. Report the pass rate in the README.
- **Reviewer**: checks security (no secrets, input validation), correctness (no LLM math), README accuracy and prompt-history completeness before each merge.

## Prompt history (required by Cloudflare)

- Keep **`PROMPTS.md`** at the repo root. Append every prompt given to any agent (including this one), in order, with timestamp, agent role and a one-line note of the outcome. Don't include secrets or tokens.
- If the environment can export raw session transcripts, also save them under `prompt-history/`.

## Deliverables and acceptance criteria

- [ ] Public repo `annah-dev/cf-billing-copilot` with an MIT license.
- [ ] Deployed demo URL on `*.workers.dev` (or Pages), linked at the top of the README.
- [ ] README includes: a one-paragraph pitch; how each of Cloudflare's four required components is used; an architecture diagram; the "LLM never does money math" principle; demo script (5 clicks/questions that show every user story); local setup and deploy commands; eval results; known limitations and what I'd build next for a production billing platform (e.g. metering pipeline at scale, revenue recognition, tax engine integration, reconciliation jobs, SLOs); and an honest note that the project was built with AI-assisted coding under my direction.
- [ ] `npm test` passes (billing-engine unit tests plus the eval harness).
- [ ] The duplicate-charge credit flow works end to end: request → pending → approve in admin → credit applied → audit visible.
- [ ] `PROMPTS.md` complete.
- [ ] No real customer, employer or personal data anywhere in the repo.

## Working rules

- Start by having the Architect confirm the plan and current Cloudflare APIs, then build in small, reviewable commits.
- If a Cloudflare API or template differs from this prompt, follow the current docs and note the change in `docs/DECISIONS.md`.
- Ask me before creating paid resources, changing account settings, or doing anything outside this repo and my Cloudflare account.
- Don't write claims about my career or employers into the repo beyond my name as author.
