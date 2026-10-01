# cf-billing-copilot

**Live demo:** https://cf-billing-copilot.anna-hester.workers.dev (synthetic data; each browser
gets its own sandbox)

A billing copilot for a customer of a usage-based product, running entirely on Cloudflare. Ask
why the September bill is $412.87, what changed since August, or what the Pro plan would have
cost, and the copilot answers from a deterministic billing engine: every amount it says comes from
a tool result, computed in integer cents. It spots the usage spike on its own. When the customer
was charged twice, it starts a credit request that a durable Workflow validates against the
ledger, reserves, and holds until a human approves or rejects it, with every step written to an
append-only audit trail the customer and the approver can both see. The model chooses tools and
explains; it never does the arithmetic.

The credit story is a duplicated debit: the September invoice charge posted twice by a billing run
retried without an idempotency key, remedied by a credit memo. A duplicated card payment would be a
refund instead, which is out of scope.

## Contents

- [Cloudflare components](#cloudflare-components)
- [Architecture](#architecture)
- [The LLM never does money math](#the-llm-never-does-money-math)
- [Demo script](#demo-script)
- [Local setup](#local-setup)
- [Deploy](#deploy)
- [Release checklist](#release-checklist)
- [Evals](#evals)
- [Cost and abuse controls](#cost-and-abuse-controls)
- [Known limitations](#known-limitations)
- [What a production billing platform needs next](#what-a-production-billing-platform-needs-next)
- [Llama 3.3 tool calls and streaming](#llama-33-tool-calls-and-streaming)
- [How this was built](#how-this-was-built)

## Cloudflare components

| Required component | How this app uses it | Code |
|---|---|---|
| **LLM: Llama 3.3 on Workers AI** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through `workers-ai-provider` and the AI SDK. It picks among 8 typed tools (`getAccount`, `getInvoice`, `explainLineItem`, `compareInvoices`, `simulatePlan`, `detectAnomalies`, `startCreditRequest`, `getCreditRequestStatus`) and explains their results. `temperature: 0`, bounded output, a small step limit, and a neuron budget reserved before every call. | `src/agent/model.ts`, `src/agent/tools.ts`, `src/contracts/tools.ts` |
| **Workflow / coordination: Workflows and Durable Objects** | `CreditRequestWorkflow` (an `AgentWorkflow`) runs validate, reserve a pending credit memo, `step.waitForEvent` for the approver with a 24-hour timeout, then apply, reject or expire. The `Ledger` Durable Object enforces the credit state machine and idempotency; an alarm-driven sweeper recovers stuck requests. | `src/workflows/credit-request.ts`, `src/ledger/ledger.ts` |
| **User input via chat** | A React chat page and an `/admin` approval page served as Workers static assets from the same Worker. The chat talks to the agent over the Agents SDK WebSocket (`useAgentChat`); a side panel shows the invoice, credit requests and audit trail. | `src/app.tsx`, `src/ui/`, `src/admin/` |
| **Memory and state: Durable Objects with SQLite** | `BillingAgent` (`AIChatAgent`), one per sandbox and customer, keeps the conversation and a small memory (account, recent questions, open credit requests) in its SQLite storage, so a returning browser picks up where it left off. The `Ledger` Durable Object's SQLite is the system of record: plans, usage, invoices, ledger entries, credit requests, memos and the audit log. `Quota` holds the global daily caps. | `src/agent/billing-agent.ts`, `src/ledger/`, `src/quota/quota.ts` |

The ledger lives in Durable Object SQLite rather than D1 (docs/DECISIONS.md D-1): one sandbox's
ledger is one object, so every credit transition, its reservation and its audit record commit
together in one SQLite transaction (`transactionSync`), which D1 cannot do across a
read-check-write, and each sandbox is isolated by construction rather than by a filter on every
query.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Chat page + side panel]
    ADM[/admin page/]
  end
  subgraph Worker["Worker (single script)"]
    R[Router: rate limiter, admission, routeAgentRequest, /api/*, assets]
  end
  subgraph DOs["Durable Objects (SQLite)"]
    A["BillingAgent<br/>per sandbox + customer<br/>chat history, memory"]
    L["Ledger<br/>per sandbox<br/>system of record + audit"]
    Q["Quota<br/>global daily caps, neuron budget"]
  end
  WF["CreditRequestWorkflow<br/>validate, reserve, wait, apply"]
  AI["Workers AI<br/>Llama 3.3 70B fp8-fast"]
  ENG["Billing engine<br/>pure TS, integer cents"]

  UI -- WebSocket chat --> R
  UI -- panel, new sandbox --> R
  ADM -- list, decide + approver token --> R
  R --> A
  R --> L
  R --> Q
  R -- approval event --> WF
  A -- tool calls --> AI
  A -- read-only RPC --> L
  A -- start credit request --> WF
  WF -- state transitions --> L
  L -- all money math --> ENG
```

- **One Worker.** Static assets for the UI; `/api/*` and `/agents/*` run the Worker first. A
  per-IP rate limiter runs before any Durable Object is touched, then every sandbox-scoped route
  checks admission (the sandbox exists and the customer is seeded) before routing.
- **Sandboxes.** Each visitor gets a fresh seeded copy of the three fictional customers, so one
  reviewer's approval never changes another's demo. "Reset demo" starts a new sandbox. Idle
  sandboxes delete themselves after 7 days.
- **Who can write money.** The agent has read methods plus exactly one write, recording a
  `requested` credit request, which moves no money. Only the token-authenticated admin endpoint
  records a decision (first writer wins); only the Workflow and the Ledger's own recovery apply,
  reject or expire. No model tool can approve or apply a credit.
- **Credit flow invariants.** Idempotency keys are unique; a pending memo reserves the disputed
  charge so two requests cannot both credit it; the credit ledger entry is unique per request;
  every transition and every refused transition writes one audit record in the same transaction.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every decision and its reason:
[docs/DECISIONS.md](docs/DECISIONS.md).

## The LLM never does money math

All rating, tiers, proration, tax, invoice totals, comparisons, plan simulations, anomaly costs
and credit amounts are computed by pure TypeScript in `src/engine/`, in integer cents with one
documented rounding rule (src/engine/README.md). Amounts leave the engine as `Money`, a pair of
integer cents and the display string from `formatUsd`, so the model only ever copies a finished
string; it is never asked to add, convert or round. The UI shows `Money.display` and never formats
or computes an amount itself. The system prompt requires every number in an answer to come from a
tool result, and to say so when data is missing. Outside `src/engine/` and `formatUsd` there is no
arithmetic on amounts (the reviewer pass greps for it).

## Demo script

Open the demo URL. Velvet Comet Workshop is selected; its September invoice is $412.87.

1. **Explain my invoice.** Click "Explain my September invoice". The copilot walks the lines
   (subscription fee, four usage meters, tax) with the amounts from `getInvoice`; each tool call
   shows a "Source verified" badge you can expand. It also flags the spike unprompted: Edge
   requests on September 18 were 5x the usual day, about $11.60 of extra cost (user stories 1
   and 4).
2. **What changed.** Click "What changed since August?". The copilot compares the two issued
   invoices by product and states the change, $299.18 to $412.87, a 38% increase (story 2).
3. **Plan simulation.** Click "What would I pay on Pro?". The engine re-rates the same September
   usage on the Pro plan and the copilot reports both totals and the difference (story 3).
4. **Credit request.** Click "I was double-charged. Can I request a credit?" and confirm in the
   dialog. The request appears in the side panel as Pending Approval for $412.87, with
   `credit_requested`, `credit_validated` and `memo_pending` in the audit trail (story 5).
5. **Approve, then come back.** Click "Approver view", enter a reason and click "Approve credit".
   Back in the chat, click Refresh: the request shows Applied and the audit trail shows the
   decision, `credit_approved` and `credit_applied`. Reload the page (or return later in the same
   browser) and ask "What's the status of my credit request?": the copilot remembers the account
   and the open request (story 6).

The seed also holds one historical request that expired after 24 hours without a decision, so the
timeout path is visible without waiting a day.

## Local setup

Requirements: a current Node.js (built and tested on Node 24) and a Cloudflare account. Workers AI always runs remotely, so every
chat message in local dev spends real neurons (docs/DECISIONS.md DEV-12).

    npm ci
    npm run typecheck
    npm test                      # offline: engine, agent, workflow, UI and eval replay tests
    npx wrangler login            # once, for the remote AI binding used by local dev
    VITE_BILLING_API_MODE=live npm run dev

Without `VITE_BILLING_API_MODE=live` the UI runs as a labelled fixture preview ("Seed preview")
that makes no AI calls (docs/DECISIONS.md "ui: Fixture transport and live handoff").

No secrets are needed: the approver token is generated per sandbox and only its SHA-256 is stored
(D-4).

## Deploy

The owner deploys; agents never run these.

    npm ci
    npx wrangler login
    VITE_BILLING_API_MODE=live npm run deploy

`npm run deploy` is `vite build && wrangler deploy`. The Worker, its three Durable Object classes,
the Workflow and the rate limiter are all declared in `wrangler.jsonc`; nothing is created by hand.

## Release checklist

1. **Checks on the release commit.** `npm ci && npm run typecheck && npm test` pass.
2. **Deploy.** `VITE_BILLING_API_MODE=live npm run deploy` (above).
3. **Smoke test the live UI** (about 5 model calls). Open the demo URL in a private window.
   Confirm the "Seed preview" banner is absent. Request a credit ("My September invoice debit was
   posted twice. Please request a credit for the duplicate charge."), confirm it, and check the
   panel shows Pending Approval. Open "Approver view", approve with a reason, return, click
   Refresh: Applied, with `decision_received`, `credit_approved` and `credit_applied` in the audit
   trail.
4. **Smoke test by curl** (one `/turn`, about 3 model calls). Requires `jq`.

        U=https://cf-billing-copilot.anna-hester.workers.dev
        S=$(curl -s -X POST $U/api/sandboxes); SID=$(echo "$S" | jq -r .sandboxId); TOK=$(echo "$S" | jq -r .approverToken)
        curl -s -X POST $U/api/sandboxes/$SID/customers/cus_1/turn -H 'content-type: application/json' \
          -d '{"message":"I was double-charged for my September invoice. Can I get a credit for the duplicate charge?","confirm":true}' | jq '.toolCalls[].name, .usage'
        curl -s $U/api/sandboxes/$SID/admin/credit-requests -H "authorization: Bearer $TOK" | jq '.requests[] | {id, status}'
        RID=$(curl -s $U/api/sandboxes/$SID/admin/credit-requests -H "authorization: Bearer $TOK" | jq -r '[.requests[] | select(.status=="pending_approval")][0].id')
        curl -s -X POST $U/api/sandboxes/$SID/admin/credit-requests/$RID/decision -H "authorization: Bearer $TOK" \
          -H 'content-type: application/json' -d '{"decision":"approve","reason":"smoke test"}' | jq .request.status
        curl -s $U/api/sandboxes/$SID/customers/cus_1/panel | jq '.creditRequests[] | {id, status}, [.audit[:5][] | .action]'

   Expect `startCreditRequest` among the tool calls, the request `pending_approval`, then
   `applied` within a few seconds of the approval, and `credit_applied` at the top of the audit
   trail. Also check that the admin list answers 401 without the token.
5. **Off switch.** To take the demo offline without deleting any data, disable the Worker's
   workers.dev route in the Cloudflare dashboard (the Worker's domains and routes settings).
   Enabling the route again restores it.

## Evals

<!-- release: the live pass rate and date are filled in after the evals PR merges and eval:live
runs once against the deployed URL. -->

The eval set (`evals/`) asks the copilot 12 to 15 questions covering all six user stories. Each
expected number is computed by calling the engine on the seed, never typed by hand, and the
harness checks that every expected number appears in the answer and that every number in the
answer traces to a tool result.

- **Replay mode** runs inside `npm test` against committed recordings, offline.
- **Live mode** (`npm run eval:live`) runs the set against the deployed URL and re-records.

**Live result: _pending_ (run date _pending_).**

## Cost and abuse controls

The public demo runs on the Workers Paid plan with these controls (docs/DECISIONS.md D-7, D-8, D-13):

- **Model budget.** Model calls stop for the day at an estimated 50,000 Workers AI neurons per UTC
  day, reserved before each call. That is at most about $0.44 a day above the included allowance.
- **Caps.** Per sandbox per UTC day: 30 chat messages of up to 2,000 characters, 5 credit requests
  and 200 API requests. Per IP: 5 new sandboxes a day. Globally: 200 new sandboxes a day.
- **Estimated, not hard-bounded.** The caps bound abuse cost at an estimated figure (about $34 a
  month above the $5 plan with every cap saturated all month), not a hard ceiling. A request
  refused by a cap still costs one Durable Object request.
- **Rate limiter.** A per-IP limit of 60 requests a minute to the API and agent routes runs before
  any Durable Object is called (Workers Rate Limiting binding). It is per Cloudflare location and
  approximate by design: a brake, not an accounting system.
- **Budget alert.** A $10 budget alert is set on the Cloudflare account. It only sends email; it
  does not stop anything.
- **Off switch.** Disable the Worker's workers.dev route in the Cloudflare dashboard (the Worker's
  domains and routes settings). The demo goes offline without deleting any data; enabling the
  route again restores it.

## Known limitations

- **Demo-grade approval.** The approver token is per sandbox and the requester and approver are
  the same browser, so there is no separation of duties. The token travels in the `/admin` link's
  URL fragment (never sent to the server) and is kept in localStorage. Production would put
  `/admin` behind Cloudflare Access with SSO, record the approver's identity, and forbid a
  requester from approving their own credit (D-4).
- **Sandboxes are not accounts.** Anyone holding a sandbox id can read that sandbox's synthetic
  panel. A production system keys the agent by authenticated account and shards the ledger per
  billing account.
- **Fixed synthetic calendar.** The seed's history is dated September and October 2026 and does
  not move with the clock, so the historical expired request can carry a deadline later than a
  request made today.
- **No token streaming.** Answers appear a step at a time rather than word by word, because tool
  calls need simulated streaming on Llama 3.3 (below).
- **The model can still be wrong in words.** Amounts come from tools, but the model can miscount
  or misdescribe (for example the number of invoice lines), and it may try a tool with an invented
  id before looking the real one up; the tool rejects the bad input and the customer must confirm
  every credit request.
- **One currency, one simplified tax rate**, monthly invoices, no payments processor, no refunds.

## What a production billing platform needs next

- **Metering at scale.** An idempotent usage ingestion pipeline (Queues or Pipelines into R2 and
  an analytics store), late and corrected usage handling, and rating that runs incrementally
  instead of re-rating a month in memory.
- **Ledger and reconciliation.** A double-entry ledger per billing account, daily reconciliation
  jobs between usage, invoices, the ledger and the payment processor, and alerts on drift.
- **Revenue recognition** that turns invoices and credits into recognised revenue by period and
  feeds the general ledger.
- **Tax engine integration** (jurisdiction, exemption certificates, credit-note tax reversal)
  instead of one flat rate.
- **Approvals and controls.** SSO-backed approvers, separation of duties, amount thresholds that
  need a second approver, and audit exports.
- **SLOs and operations.** Invoice correctness and timeliness SLOs, Workflow backlog and
  stuck-request alerts, replayable recovery, and dashboards on credit volume and model spend.
- **Customer scale.** Multi-currency, plan migrations mid-cycle at volume, dunning, and data
  retention rules per region.

## Llama 3.3 tool calls and streaming

With native streaming (`streamText` straight through `workers-ai-provider`), Llama 3.3's tool-call
arguments arrived garbled and the tool never ran. The Stop 2 round trip recorded arguments like:

    {"customerId": "{"customerId": "cuscus_ac_acme"}me"}

(from the Stop 2 scaffold tool, which took a `customerId`; docs/DECISIONS.md DEV-16). It failed
the same way on the pinned versions (`workers-ai-provider` 3.3.1 with `ai` 6) and on the newest
then available (4.0.0 with `ai` 7), while non-streaming `generateText` worked on both. The fix is
the AI SDK's `simulateStreamingMiddleware`: one non-streaming call per step, replayed to the chat
as a stream, which keeps `streamText` and `AIChatAgent` working (D-14). The cost is that text
arrives a step at a time.

## How this was built

This project was built with AI-assisted coding under Anna Hester's direction. Anna wrote the
assignment, made the product, security and cost decisions recorded as "Decided by: Anna" in
docs/DECISIONS.md, and merged every pull request. Claude Code and Codex agents worked in parallel
lanes (architecture, billing engine, agent and Workflow, UI, evals, release), each in its own git
worktree, and every pull request was reviewed by the harness that did not write it. Every prompt
is in [PROMPTS.md](PROMPTS.md), and the scrubbed raw session transcripts are in
[prompt-history/transcripts/](prompt-history/transcripts/).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
