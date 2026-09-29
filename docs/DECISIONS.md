# Decisions

Docs read on 2026-09-29. Entries marked PROPOSED wait for the owner's approval at Stop 1; the rest
are decided. Later stops append to this file (the C3 version and template commit land at Stop 2).

## Where the assignment differs from the current docs

| # | Assignment says | Current docs and packages say | What we do |
|---|---|---|---|
| DEV-1 | Llama 3.3 is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` "or the current Llama 3.3 model ID" | Still the only Llama 3.3 in the catalog, not deprecated (it survived the 2026-05-30 deprecations), function calling supported, 24,000-token context window | Use it unchanged. Budget prompts for the 24k context. |
| DEV-2 | Prefer the `agents-starter` template | Still current (HEAD `4ea6a72`, 2026-07-24), but it defaults to `@cf/moonshotai/kimi-k2.7-code`, not Llama | Scaffold from the starter at that commit and switch the model to Llama 3.3. |
| DEV-3 | "Cloudflare Agents SDK" chat agent | `AIChatAgent` now lives in its own package, `@cloudflare/ai-chat` (React hook in `@cloudflare/ai-chat/react`); `Agent` stays in `agents` | Import from `@cloudflare/ai-chat`. |
| DEV-4 | `npm create cloudflare@latest` | The owner's process forbids `@latest`; C3 latest is 2.73.1 (2026-09-29) and accepts `--template cloudflare/agents-starter#<sha> --no-deploy --no-git --no-open` | Pin both C3 and the template commit (Stop 2). |
| DEV-5 | (implicit) the starter's versions are current | The starter locks `agents` 0.17.4, `@cloudflare/ai-chat` 0.9.3, `ai` 6.0.x, `workers-ai-provider` 3.3.1, `wrangler` 4.113.0. Latest are 0.24.0, 0.12.0, 7.0.122, 4.0.0, 4.144.0. The `^0.17.4` range never reaches 0.24. | See D-2 (PROPOSED). |
| DEV-6 | `npm test` runs unit tests and evals | The starter has no test runner, no `tests/`, no `tools.ts` (tools inline in `server.ts`) | Add vitest and `@cloudflare/vitest-pool-workers` at Stop 2. |
| DEV-7 | Workflow and DO are separate choices ("Workflows and/or Durable Objects") | The Agents SDK has first-class Workflow integration: `AgentWorkflow` (`agents/workflows`), `this.runWorkflow()`, `this.agent` RPC from the Workflow, progress callbacks | Use both: `CreditRequestWorkflow extends AgentWorkflow` (D-9). |
| DEV-8 | `step.waitForEvent` for the approval | Signature `step.waitForEvent(name, { type, timeout })`, default timeout 24 hours, max 365 days. On timeout it throws and the instance fails unless caught; no error class is documented. Events sent before the wait are buffered. | Catch around that one call and move to an explicit `expired` state (D-6). |
| DEV-9 | Workflow instance per credit request, retries never duplicate | `create({ id })` throws if the id exists within retention; it is not idempotent (only `createBatch` skips existing ids) | Idempotency is enforced by a UNIQUE key in the Ledger; the Workflow id is derived from the request id and a create conflict is treated as "already started". |
| DEV-10 | (implicit) Workflow state is durable | Free plan keeps completed instance state 3 days; 3,000 steps per day; 10 ms CPU per step | The Ledger is the source of truth for credit status, never the Workflow. Engine work inside a step stays small. |
| DEV-11 | Stay within free tiers | Workers AI Free is 10,000 neurons per day, resets 00:00 UTC, fails past it. Llama 3.3 costs 26,668 neurons per M input tokens and 204,805 per M output: about 250 to 300 neurons per tool-using turn, about 35 turns per day in total | Global neuron budget, per-sandbox caps (D-7) and an explicit capacity decision (D-8). |
| DEV-12 | (implicit) local dev is free | "AI models always run remotely": every `npm run dev` model call spends real neurons and needs `wrangler login` | Tests stub the AI binding; manual dev model calls are deliberate and few. |
| DEV-13 | DO SQLite via migrations | Docs now also offer an `exports` block (`"storage": "sqlite"`). After one deploy with `exports` a Worker cannot go back to `migrations`. The starter uses `migrations` with `new_sqlite_classes`. | Keep `migrations` + `new_sqlite_classes` (D-10). |
| DEV-14 | Function-calling examples in the docs | The Workers AI function-calling page and AI SDK page still use deprecated model ids (`hermes-2-pro-mistral-7b`, `llama-2-7b-chat-int8`); `workers-ai-provider` 4 targets AI SDK v7 | Do not copy model ids from those examples. |

Unverified at Stop 1, to settle in Stop 2 with a local test: whether `waitForEvent` resolves to the
raw payload or an event wrapper, the error name on timeout, and whether streaming with tools returns
`tool_calls` for Llama 3.3 through `workers-ai-provider`.

## D-1 Ledger store: Durable Object SQLite, not D1 (decided)

One `Ledger` Durable Object per sandbox holds every billing table and the audit log.

- Single source of truth with real transactions. `ctx.storage.sql` plus `transactionSync` lets a
  state transition and its audit record commit together or not at all. D1 offers batches but no
  interactive transaction across a read-check-write.
- The isolation boundary is free. Each demo sandbox is its own object with its own database, so a
  reset or an abusive visitor cannot touch another sandbox. In D1 every table would need a
  `sandbox_id` column and every query a filter that must never be forgotten.
- No extra resource. Durable Objects with SQLite are on the Free plan and are already required for
  the chat agent. D1 would be one more resource to create and approve.
- Colocation. The Ledger's queries run next to the data with a synchronous API, which keeps the
  10 ms CPU budget realistic.
- Separation of concerns. The ledger is a different object from the chat agent: `BillingAgent` has
  read-only RPC methods on it, and only `CreditRequestWorkflow` calls the transition methods. The
  model cannot reach a write path.
- Trade-off accepted: cross-sandbox reporting (for example "all pending credits across the demo")
  needs fan-out. Nothing in scope needs it. In production the ledger would be sharded per billing
  account and fed to a warehouse for reporting.

## D-2 SDK versions (PROPOSED)

Recommendation: scaffold at starter commit `4ea6a72` and keep its locked versions (`agents` 0.17.4,
`@cloudflare/ai-chat` 0.9.3, `ai` 6, `workers-ai-provider` 3.3.1). They were released together and the
starter was fixed against them in July. The Stop 2 model round trip proves Llama 3.3 tool calling on
this set. Upgrade to `agents` 0.24 / `ai` 7 / `workers-ai-provider` 4 only if that round trip fails,
as its own PR. Alternative: upgrade first and absorb whatever breaks before the lanes fork.

## D-3 Demo tenancy: per-visitor sandbox (PROPOSED)

Each browser gets its own seeded copy of the 3 customers (docs/ARCHITECTURE.md, "Tenancy"). Chat
memory is per sandbox and customer, so it persists across sessions from the same browser.
Alternative: one shared world that every reviewer sees, plus a reset. That is simpler but lets one
reviewer's approval or reset change another's demo mid-script.

## D-4 How a reviewer approves a credit without a secret in the repo (PROPOSED)

Recommendation: a per-sandbox approver token. `POST /api/sandboxes` generates a random token, stores
only its SHA-256 in the sandbox's Ledger and returns it once. The chat panel links to
`/admin#token=...` for that sandbox (fragment, so it never reaches server logs). Admin endpoints
require `Authorization: Bearer <token>` and compare hashes in constant time. No secret exists in the
repo or in `wrangler secret`, and a reviewer can only approve credits in their own sandbox. The
README labels this demo-grade: the requester and the approver are the same browser, so there is no
separation of duties; production would put `/admin` behind Cloudflare Access (SSO) with the approver
identity in the audit record and a rule that the requester cannot approve.
Alternatives: (a) one `ADMIN_TOKEN` set with `wrangler secret put` and given to reviewers in the
submission form, which blocks reviewers who do not have it; (b) Cloudflare Access now, which needs
account settings and reviewer emails.

## D-5 How a reviewer resets the demo (PROPOSED)

Recommendation: a "Reset demo" button (approver token required) that restores the sandbox in place:
terminate that sandbox's open Workflows, wipe and reseed the Ledger, clear the sandbox's agent
histories and memory, and increment the sandbox `epoch`. Every Workflow carries the epoch it was
started in, and the Ledger refuses a transition from an older epoch, so a straggling Workflow cannot
write into the fresh story. The new audit log starts with a `sandbox_reset` record. Alternative:
"start a new sandbox" only, abandoning the old one (simpler, but the old sandbox's history and
links stop matching what the reviewer sees). Either way, idle sandboxes delete their storage via a
Durable Object alarm after 7 days.

## D-6 When an approval never arrives (PROPOSED)

- `waitForEvent("approval", { type: "approval", timeout: APPROVAL_TIMEOUT })`, with
  `APPROVAL_TIMEOUT` a wrangler var defaulting to `24 hours`, well inside the 3-day retention.
- On timeout the Workflow runs `step.do("expire")`: status `expired`, memo `void`, audit record
  `credit_expired` with actor `system` and reason "no approver decision within 24 hours". Expired is
  terminal.
- Defense in depth: the Ledger sets an alarm at each request's deadline plus 1 hour and expires any
  request still pending (actor `system:sweeper`), covering a Workflow that errored or was purged.
- An approval that arrives after expiry is refused with HTTP 409 and audited as
  `approval_refused_expired`.
- Reviewers see the state without waiting a day: the seed includes one historical expired request
  with its audit trail, and tests cover expiry with `forceEventTimeout`.

## D-7 Abuse of the public chat URL (PROPOSED)

- Per sandbox: 30 user messages per UTC day, 2,000 characters per message, 5 credit requests per day.
- Per IP (`CF-Connecting-IP`, stored hashed in `Quota`): 5 new sandboxes per UTC day.
- Global: stop model calls at an estimated 8,000 neurons per UTC day (from AI SDK token usage), which
  leaves headroom under the 10,000 free neurons. Past any cap the agent answers with a fixed message
  that names the cap and the 00:00 UTC reset; it never calls the model.
- The Workers Rate Limiting binding only supports 10 or 60 second windows and is per location, so it
  cannot hold daily caps; `Quota` is a single Durable Object for exact counting.

## D-8 Free-plan capacity for the live demo (PROPOSED)

About 35 tool-using turns per day is enough for a few reviewers but not many, and one
`npm run eval:live` run (12 to 15 questions) can use most of a day's budget. Recommendation: stay on
Free, enforce D-7, keep the system prompt and tool schemas short, and run `eval:live` right after
00:00 UTC on a day with no expected reviewers. Alternative: Workers Paid ($5 per month, then $0.011
per 1,000 neurons), which removes the ceiling; the owner has said to ask before anything Paid.

## D-9 AgentWorkflow for the credit flow (decided)

`CreditRequestWorkflow extends AgentWorkflow<BillingAgent, Params>` so the agent starts it with
`this.runWorkflow("CREDIT_WORKFLOW", params)` and gets progress callbacks it can broadcast to the
chat. The Workflow still writes only through the `Ledger`, never through agent state.

## D-10 Durable Object config style (decided)

Keep the starter's `migrations` with `new_sqlite_classes` for `BillingAgent`, `Ledger` and `Quota`.
It matches the starter and the vitest pool docs, and it keeps the move to `exports` available later;
the reverse move is impossible once deployed.

## D-11 Cloudflare resources (PROPOSED for approval)

One Worker on `*.workers.dev` with: static assets, the `AI` binding, three SQLite Durable Object
classes (`BillingAgent`, `Ledger`, `Quota`) and one Workflow (`CreditRequestWorkflow`). No D1, KV,
R2, Queues, secrets or paid features. The existing workers.dev subdomain is used as is.
