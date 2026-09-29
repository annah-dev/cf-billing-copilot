# Decisions

Docs read on 2026-09-29. The owner answered the Stop 1 questions the same day. Every entry names
who decided it (AGENTS.md, "Decision rights"). Later stops append to this file (the C3 version and
template commit land at Stop 2).

## Where the assignment differs from the current docs

"Architect" below means the Architect under standing orders.

| # | Assignment says | Current docs and packages say | What we do | Decided by |
|---|---|---|---|---|
| DEV-1 | Llama 3.3 is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` "or the current Llama 3.3 model ID" | Still the only Llama 3.3 in the catalog, not deprecated (it survived the 2026-05-30 deprecations), function calling supported, 24,000-token context window | Use it unchanged. Budget prompts for the 24k context. | Architect |
| DEV-2 | Prefer the `agents-starter` template | Still current (HEAD `4ea6a72`, 2026-07-24), but it defaults to `@cf/moonshotai/kimi-k2.7-code`, not Llama | Scaffold from the starter at that commit and switch the model to Llama 3.3. | Architect |
| DEV-3 | "Cloudflare Agents SDK" chat agent | `AIChatAgent` now lives in its own package, `@cloudflare/ai-chat` (React hook in `@cloudflare/ai-chat/react`); `Agent` stays in `agents` | Import from `@cloudflare/ai-chat`. | Architect |
| DEV-4 | `npm create cloudflare@latest` | The owner's process forbids `@latest`; C3 latest is 2.73.1 (2026-09-29) and accepts `--template cloudflare/agents-starter#<sha> --no-deploy --no-git --no-open` | Pin both C3 and the template commit (Stop 2). | Anna |
| DEV-5 | (implicit) the starter's versions are current | The starter locks `agents` 0.17.4, `@cloudflare/ai-chat` 0.9.3, `ai` 6.0.x, `workers-ai-provider` 3.3.1, `wrangler` 4.113.0. Latest are 0.24.0, 0.12.0, 7.0.122, 4.0.0, 4.144.0. The `^0.17.4` range never reaches 0.24. | See D-2. | Anna |
| DEV-6 | `npm test` runs unit tests and evals | The starter has no test runner, no `tests/`, no `tools.ts` (tools inline in `server.ts`) | Add vitest and `@cloudflare/vitest-pool-workers` at Stop 2. | Architect |
| DEV-7 | Workflow and DO are separate choices ("Workflows and/or Durable Objects") | The Agents SDK has first-class Workflow integration: `AgentWorkflow` (`agents/workflows`), `this.runWorkflow()`, `this.agent` RPC from the Workflow, progress callbacks | Use both: `CreditRequestWorkflow extends AgentWorkflow` (D-9). | Architect |
| DEV-8 | `step.waitForEvent` for the approval | Signature `step.waitForEvent(name, { type, timeout })`, default timeout 24 hours, max 365 days. On timeout it throws and the instance fails unless caught; no error class is documented. Events sent before the wait are buffered. | Catch around that one call and move to an explicit `expired` state (D-6). | Architect |
| DEV-9 | Workflow instance per credit request, retries never duplicate | `create({ id })` throws if the id exists within retention; it is not idempotent (only `createBatch` skips existing ids) | Idempotency is enforced by a UNIQUE key in the Ledger; the Workflow id is derived from the request id and a create conflict is treated as "already started". | Architect |
| DEV-10 | (implicit) Workflow state is durable | Completed instance state is kept 3 days on Free and 30 days on Paid; Paid includes 500,000 steps per month | The Ledger is the source of truth for credit status, never the Workflow, even with 30-day retention. | Anna |
| DEV-11 | Stay within free or low-cost tiers | Workers AI includes 10,000 neurons per day (reset 00:00 UTC), then $0.011 per 1,000 on Paid. Llama 3.3 costs 26,668 neurons per M input tokens and 204,805 per M output: about 250 to 300 neurons per tool-using turn. The Free allowance alone is about 35 turns per day for everyone. | Workers Paid with a 50,000-neuron daily stop (D-7, D-8). | Anna |
| DEV-12 | (implicit) local dev is free | "AI models always run remotely": every `npm run dev` model call spends real neurons and needs `wrangler login` | Tests stub the AI binding; manual dev model calls are deliberate and few. | Architect |
| DEV-13 | DO SQLite via migrations | Docs now also offer an `exports` block (`"storage": "sqlite"`). After one deploy with `exports` a Worker cannot go back to `migrations`. The starter uses `migrations` with `new_sqlite_classes`. | Keep `migrations` + `new_sqlite_classes` (D-10). | Architect |
| DEV-14 | Function-calling examples in the docs | The Workers AI function-calling page and AI SDK page still use deprecated model ids (`hermes-2-pro-mistral-7b`, `llama-2-7b-chat-int8`); `workers-ai-provider` 4 targets AI SDK v7 | Do not copy model ids from those examples. | Architect |
| DEV-15 | (implicit) the SDK approval helper takes a timeout | In both `agents` 0.17.4 and 0.24.0 the doc comment shows `waitForApproval(step, { timeout: '7 days' })`, but the installed type is `WaitForApprovalOptions = { eventType?: string }`: no timeout | Installed types win. The Workflow calls `step.waitForEvent` directly with an explicit timeout, using the event type that `approveWorkflow` and `rejectWorkflow` send (D-6). | Architect |

Unverified at Stop 1, to settle in Stop 2 with a local test: whether `waitForEvent` resolves to the
raw payload or an event wrapper, the error name on timeout, which event type `approveWorkflow`
sends, and whether streaming with tools returns `tool_calls` for Llama 3.3 through
`workers-ai-provider`.

## D-1 Ledger store: Durable Object SQLite, not D1

One `Ledger` Durable Object per sandbox holds every billing table and the audit log.

- Single source of truth with real transactions. `ctx.storage.sql` plus `transactionSync` lets a
  state transition and its audit record commit together or not at all. D1 offers batches but no
  interactive transaction across a read-check-write.
- The isolation boundary is free. Each demo sandbox is its own object with its own database, so an
  abusive visitor cannot touch another sandbox. In D1 every table would need a `sandbox_id` column
  and every query a filter that must never be forgotten.
- No extra resource. SQLite-backed Durable Objects are already required for the chat agent. D1
  would be one more resource to create and approve.
- Colocation. The Ledger's queries run next to the data with a synchronous API.
- Separation of concerns. The ledger is a different object from the chat agent: `BillingAgent` has
  read-only RPC methods on it, and only `CreditRequestWorkflow` calls the transition methods. The
  model cannot reach a write path.
- Trade-off accepted: cross-sandbox reporting needs fan-out. Nothing in scope needs it. In
  production the ledger would be sharded per billing account and fed to a warehouse for reporting.

Decided by: Architect under standing orders.

## D-2 SDK versions

Scaffold at starter commit `4ea6a72` and keep its locked versions (`agents` 0.17.4,
`@cloudflare/ai-chat` 0.9.3, `ai` 6, `workers-ai-provider` 3.3.1). They were released together and
the starter was fixed against them in July, but only with its default Kimi model: Llama 3.3 tool
calling on this set is unverified until the Stop 2 round trip. Upgrade to `agents` 0.24 / `ai` 7 /
`workers-ai-provider` 4 only if that round trip fails, as its own PR.

The workflow approval API is the same in both versions (checked in the installed `.d.ts` files of
`agents` 0.17.4 and 0.24.0): `waitForApproval<T>(step, options?: { eventType?: string })`,
`approveWorkflow(workflowId, { reason?, metadata? })`, `rejectWorkflow(workflowId, { reason? })`,
and `WorkflowRejectedError(reason?, workflowId?)`. So a later upgrade does not reshape the credit
flow. Every lane prompt states that installed type definitions win over web docs.

Decided by: Anna.

## D-3 Demo tenancy: per-visitor sandbox

Each browser gets its own seeded copy of the 3 customers (docs/ARCHITECTURE.md, "Tenancy"). Chat
memory is per sandbox and customer, so it persists across sessions from the same browser. A shared
world would let one reviewer's approval change another's demo mid-script.

Decided by: Anna.

## D-4 How a reviewer approves a credit without a secret in the repo

A per-sandbox approver token. `POST /api/sandboxes` generates a random token, stores only its
SHA-256 in the sandbox's Ledger and returns it once. The chat panel links to `/admin#token=...` for
that sandbox (a fragment, so it never reaches server logs). Admin endpoints require
`Authorization: Bearer <token>` and compare hashes in constant time. No secret exists in the repo or
in `wrangler secret`, and a reviewer can only approve credits in their own sandbox. The README
labels this demo-grade: the requester and the approver are the same browser, so there is no
separation of duties. Production would put `/admin` behind Cloudflare Access (SSO), with the
approver identity in the audit record and a rule that the requester cannot approve.

Decided by: Anna.

## D-5 How a reviewer resets the demo

"Reset demo" creates a new sandbox (`POST /api/sandboxes`) and the browser switches to it. The old
sandbox is abandoned, not modified: no Workflow termination and no epoch fencing are needed,
because nothing in the new sandbox shares state with the old one. A Workflow still waiting in the
old sandbox times out there and expires its request in the old Ledger. Every sandbox's Ledger and
agents set a Durable Object alarm that deletes their storage after 7 days without activity. The
reset counts against the per-IP and global sandbox caps (D-7).

Decided by: Anna.

## D-6 When an approval never arrives

- The Workflow waits with `step.waitForEvent("approval", { type, timeout: APPROVAL_TIMEOUT })`, not
  `waitForApproval`, which has no timeout parameter (DEV-15). `APPROVAL_TIMEOUT` is a wrangler var
  defaulting to `24 hours`.
- On timeout the Workflow runs `step.do("expire")`: status `expired`, memo `void`, audit record
  `credit_expired` with actor `system` and reason "no approver decision within 24 hours". Expired is
  terminal.
- Defense in depth: the Ledger sets an alarm at each request's deadline plus 1 hour and expires any
  request still pending (actor `system:sweeper`), covering a Workflow that errored.
- An approval that arrives after expiry is refused with HTTP 409 and audited as
  `approval_refused_expired`.
- Reviewers see the state without waiting a day: the seed includes one historical expired request
  with its audit trail, and tests cover expiry with `forceEventTimeout`.

Decided by: Anna.

## D-7 Abuse of the public chat URL

- Per sandbox: 30 user messages per UTC day, 2,000 characters per message, 5 credit requests per day.
- Per IP (`CF-Connecting-IP`, stored hashed in `Quota`): 5 new sandboxes per UTC day.
- Global, in `Quota`: 500 new sandboxes per UTC day. A seeded sandbox writes about 1,250 rows,
  about 2,500 counting index writes (docs/ARCHITECTURE.md, "Budgets"); 500 a day is at most about
  1.25M rows per day, about 37.5M per month, inside the 50M rows written per month that Workers
  Paid includes. The engine lane measures the real count and a test keeps it under 2,500.
- Global, in `Quota`: stop model calls at an estimated 50,000 neurons per UTC day, from AI SDK token
  usage. At most 40,000 neurons over the included 10,000, about $0.44 per day.
- Past any cap the agent answers with a fixed message that names the cap and the 00:00 UTC reset;
  it never calls the model.
- The Workers Rate Limiting binding only supports 10 or 60 second windows and is per location, so it
  cannot hold daily caps; `Quota` is a single Durable Object for exact counting.

Decided by: Anna (the global sandbox cap of 500 is sized by the Architect under standing orders).

## D-8 Capacity for the live demo

The account is on Workers Paid. The 50,000-neuron stop allows roughly 170 to 200 tool-using turns
per day across all visitors, so one `npm run eval:live` run (12 to 15 questions, about 40 model
calls) no longer crowds out reviewers. Worst-case Workers AI spend is about $0.44 per day; Durable
Objects and Workflows stay inside the Paid included amounts under the D-7 caps.

Decided by: Anna.

## D-9 AgentWorkflow for the credit flow

`CreditRequestWorkflow extends AgentWorkflow<BillingAgent, Params>` so the agent starts it with
`this.runWorkflow("CREDIT_WORKFLOW", params)` and gets progress callbacks it can broadcast to the
chat. The Workflow still writes only through the `Ledger`, never through agent state.

Decided by: Architect under standing orders.

## D-10 Durable Object config style

Keep the starter's `migrations` with `new_sqlite_classes` for `BillingAgent`, `Ledger` and `Quota`.
It matches the starter and the vitest pool docs, and it keeps the move to `exports` available later;
the reverse move is impossible once deployed.

Decided by: Architect under standing orders.

## D-11 Cloudflare resources

One Worker on `*.workers.dev`, on the Workers Paid plan, with: static assets, the `AI` binding,
three SQLite Durable Object classes (`BillingAgent`, `Ledger`, `Quota`) and one Workflow
(`CreditRequestWorkflow`). No D1, KV, R2, Queues or secrets. The existing workers.dev subdomain is
used as is.

Decided by: Anna.
