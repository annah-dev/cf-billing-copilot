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
| DEV-15 | (implicit) use the SDK approval helper as documented | In both `agents` 0.17.4 and 0.24.0, `waitForApproval(step, { stepName?, timeout?, eventType? })` waits for type `"approval"` and, on `approved: false`, calls `step.reportError` and throws `WorkflowRejectedError`. The web docs do not describe the rejection path. | The Workflow calls `step.waitForEvent` directly with the same event type and payload shape, so a rejection is a normal audited outcome rather than a Workflow error (D-6). | Architect |
| DEV-16 | (implicit) Llama 3.3 tool calling works through the provider, streaming included | Measured at Stop 2 in local dev: with `streamText`, tool-call arguments arrive garbled (`{"customerId": "{"customerId": "cuscus_ac_acme"}me"}`), the tool never runs and no answer is produced, on both `workers-ai-provider` 3.3.1 / `ai` 6 and 4.0.0 / `ai` 7. Non-streaming `generateText` works on both. | Wrap the model in the AI SDK's `simulateStreamingMiddleware` (one non-streaming call per step, replayed as a stream), which works with `streamText` and `AIChatAgent` (D-14). | Architect |

Settled from the installed `agents` source (0.17.4 and 0.24.0): `waitForEvent` resolves to an
event object whose data is under `.payload`, and `approveWorkflow` / `rejectWorkflow` send type
`"approval"` with payload `{ approved, reason?, metadata? }`. Settled by the Stop 2 round trip:
native streaming with tools does not work for Llama 3.3 (DEV-16). Still unverified: the error name
on a `waitForEvent` timeout (the agent lane settles it with `forceEventTimeout`).

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
- Separation of concerns. The ledger is a different object from the chat agent. `BillingAgent` has
  read methods plus one narrow write, `createCreditRequest`, which records a `requested` row and
  moves no money. The approver's decision is recorded by the token-authenticated admin endpoint
  (`recordDecision`, first writer wins). Validation, memo, application and expiry run only in
  `CreditRequestWorkflow` or the Ledger's own alarm. No model tool can decide, approve or apply.
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
`agents` 0.17.4 and 0.24.0): `waitForApproval<T>(step, { stepName?, timeout?, eventType? })`,
`approveWorkflow(workflowId, { reason?, metadata? })`, `rejectWorkflow(workflowId, { reason? })`,
and `WorkflowRejectedError(reason?, workflowId?)`. So a later upgrade does not reshape the credit
flow. Every lane prompt states that installed type definitions win over web docs.

Decided by: Anna.

Stop 2 result: the round trip on these versions succeeded without streaming and failed with native
streaming, and native streaming failed the same way on `ai` 7 / `workers-ai-provider` 4.0.0, so an
upgrade would not fix it. The versions stay; simulated streaming (D-14) is the fix.

Decided by: Architect under standing orders (applying D-2's upgrade condition).

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
agents delete their storage 7 days after creation or last activity, whichever is later (the
Ledger through its single alarm, the agents through the SDK scheduler). The
reset counts against the per-IP and global sandbox caps (D-7).

Decided by: Anna.

## D-6 When an approval never arrives

- The Workflow waits with
  `step.waitForEvent("wait-for-approval", { type: "approval", timeout: APPROVAL_TIMEOUT })`, using the
  SDK's approval payload shape but not `waitForApproval`, which turns a rejection into a Workflow
  error (DEV-15). `APPROVAL_TIMEOUT` is a wrangler var defaulting to `24 hours`.
- On timeout the Workflow runs `step.do("expire")`: status `expired`, memo `void`, audit record
  `credit_expired` with actor `system` and reason "no approver decision within 24 hours". Expired is
  terminal.
- Defense in depth: the Ledger's alarm (one per object, driven by a `timers` table) expires any
  request still pending an hour past its deadline with no decision (actor `system:sweeper`), and
  restarts an errored Workflow instead of assuming an existing id means a running one.
- Decisions are first-writer-wins and immutable in the Ledger; an identical retry returns the
  recorded decision, a conflicting one gets an audited 409, and a decision on an expired request
  gets 409 audited as `approval_refused_expired`. The Workflow acts on the recorded decision, never
  on the event payload, and the expire step honours a decision recorded just before the timeout.
- Reviewers see the state without waiting a day: the seed includes one historical expired request
  with its audit trail, and tests cover expiry with `forceEventTimeout`.

Decided by: Anna.

## D-7 Abuse of the public chat URL

- Per sandbox: 30 user messages per UTC day, 2,000 characters per message, 5 credit requests per day.
- Per IP (`CF-Connecting-IP`, stored hashed in `Quota`): 20 new sandboxes per UTC day (5 until
  2026-10-01; see "D-7 amendment" below).
- Global, in `Quota`: 200 new sandboxes per UTC day. With deletion 7 days after last activity that
  gives about 1,400 live sandboxes in normal use; it is not a hard bound, since a visitor can keep
  sandboxes active.
- Per sandbox, non-model traffic: 200 sandbox-scoped API requests per UTC day (429 past it, no
  write), and refusals audited once per request, action and reason, so repeated refused calls
  cannot amplify writes.
- Estimate for accepted traffic with every cap saturated all month and about 1,400 live sandboxes:
  about $34 over the $5 plan (Workers AI about $13, a hard daily limit; Durable Objects and
  Workflows about $21; arithmetic in docs/ARCHITECTURE.md, "Budgets"). It is an estimate, not a
  ceiling: refused calls still cost Durable Object requests, and the live count is not hard-bounded
  (D-13). Normal demo traffic stays inside the included amounts. The agent lane measures real
  rows written and a test fails above 2,500 per phase.
- Global, in `Quota`: stop model calls at an estimated 50,000 neurons per UTC day. Each inference
  call, including tool continuations, reserves its worst-case estimate atomically before it runs
  (bounded `maxOutputTokens`, small step limit) and reconciles with actual usage after, so
  concurrent turns cannot overspend. At most 40,000 neurons over the included 10,000, about $0.44
  per day.
- Past any cap the agent answers with a fixed message that names the cap and the 00:00 UTC reset;
  it never calls the model.
- The Workers Rate Limiting binding only supports 10 or 60 second windows and is per location, so it
  cannot hold daily caps; `Quota` is a single Durable Object for exact counting.

Decided by: Anna (the global sandbox cap of 200, the non-model request cap, refusal-audit
deduplication and the reservation mechanism by the Architect under standing orders).

## D-8 Capacity for the live demo

The account is on Workers Paid. The 50,000-neuron stop allows roughly 170 to 200 tool-using turns
per day across all visitors, so one `npm run eval:live` run (12 to 15 questions, about 40 model
calls) no longer crowds out reviewers. Worst-case Workers AI spend is about $0.44 per day. Normal
traffic keeps Durable Objects and Workflows inside the Paid included amounts; accepted traffic with
every D-7 cap saturated all month adds about $21 (an estimate, not a ceiling; see D-13).

Decided by: Anna.

## D-9 AgentWorkflow for the credit flow

`CreditRequestWorkflow extends AgentWorkflow<BillingAgent, Params>` so the agent starts it with
`this.runWorkflow("CREDIT_WORKFLOW", params, { id: requestId })` (without `id` the SDK generates a
random one) and gets progress callbacks it can broadcast to the chat. On an "already exists" error
the caller reads the instance status: active states are left alone, `errored` or `terminated`
instances are restarted (every step is an idempotent Ledger call). The Workflow still writes only
through the `Ledger`, never through agent state.

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

## D-12 Ledger invariants, recovery and admission (from PR #1 review, rounds 1 and 2)

- No double credit across idempotency keys: pending plus applied memos per disputed ledger entry
  never exceed the engine's creditable amount; the pending memo is the reservation, written
  atomically. Reason: a UNIQUE idempotency key alone lets two different keys credit one charge.
- Idempotent transitions: reaching an already-reached target state returns the recorded result
  without a new audit record. Reason: a Workflow step can replay after its transaction committed.
- Recovery: the Ledger alarm re-drives `requested` (create, leave, or restart by instance status),
  re-applies `approved` without a credit, and expires or decides stale `pending_approval`, all from
  one alarm driven by a `timers` table. Reason: no non-terminal state may strand, and a Durable
  Object has only one alarm.
- Decisions: first writer wins, immutable, the Workflow acts on the recorded decision. Reason: two
  competing decisions must not let money move against the recorded one (round 2).
- Non-model caps and refusal-audit deduplication. Reason: refused calls must not amplify writes
  (round 2).
- Admission: every sandbox-scoped route, including the agent route, requires a sandbox created by
  `POST /api/sandboxes` and a seeded customer; a rejected name seeds and writes nothing. Reason: name-based
  routing alone would let anyone create agents and bypass the sandbox caps.

Decided by: Architect under standing orders.

## D-13 Abuse cost: estimated bound, rate limiter, budget alert, off switch

PR #1 review round 3 showed the D-7 caps bound accepted traffic, not total cost: caps are counted
inside Durable Objects, so a refused call still costs one Durable Object request, and deletion 7 days
after last activity does not bound the live sandbox count.

- Abuse cost is bounded by the caps at an estimated figure (about $34 a month above the $5 plan with
  every cap saturated all month), not a hard ceiling. The README says so.
- A per-IP Workers Rate Limiting binding (`RATE_LIMITER`, 60 requests per 60 seconds, namespace
  1001) runs in the Worker before any Durable Object is invoked, on every `/api/*` and `/agents/*`
  request. It is per location and approximate by design.
- Anna set a $10 budget alert on the account. It only sends email.
- Off switch: disable the workers.dev route in the dashboard. The demo goes offline and no data is
  deleted. It is an item in the release checklist.
- Not chosen: a hard sandbox lifetime. It only bounds storage, which costs cents, so it is not worth
  reopening D-5.

Decided by: Anna.

## D-14 Simulated streaming for Llama 3.3 tool calls

`BillingAgent` wraps the model as
`wrapLanguageModel({ model: workersai(MODEL_ID), middleware: simulateStreamingMiddleware() })` and
keeps `streamText` and `AIChatAgent`. Reason: native streaming garbles tool arguments (DEV-16);
the simulated stream produced a correct tool call, tool result and answer in the Stop 2 round trip.
Cost: the UI shows each step's text at once instead of token by token.

Decided by: Architect under standing orders.

## D-15 Money travels with its display string

Every amount in a contract is `Money` (`{ cents, display }`), with `display` produced only by
`formatUsd` and checked by the schema; ratios are `Percent` (basis points) and `Multiple`
(hundredths) with display strings. Reason: in the Stop 2 round trip the model turned
`balanceCents: 41287` into "$412.87" itself, which is the money math the assignment forbids. With
display strings in every tool result, the model only copies.

Decided by: Architect under standing orders.

## D-16 Scaffold record

- `npx -y create-cloudflare@2.73.1 cf-billing-copilot --template
  cloudflare/agents-starter#4ea6a72cbabe2b62a66294214361ac106b4a247e --no-deploy --no-git --no-open
  --no-agents --no-auto-update`, run in a scratch directory outside the repo and copied in.
  `--no-agents` skips C3's generated AGENTS.md (this repo has its own); `--no-auto-update` stops C3
  replacing itself with a newer version.
- Installed versions: `agents` 0.17.4, `@cloudflare/ai-chat` 0.9.3, `ai` 6.0.233,
  `workers-ai-provider` 3.3.1, `zod` 4.4.3, `vite` 8.1.5, `@cloudflare/vite-plugin` 1.46.0,
  `typescript` 6.0.3. C3 raised `wrangler` to 4.144.0.
- Not copied: the starter's README, LICENSE (its MIT notice is kept in THIRD_PARTY_NOTICES.md),
  `.github/` workflows, `.vscode/` and banner image. `ChatAgent` became `BillingAgent`.
- npm 11 blocked workerd's postinstall because the starter's `allowScripts` named an older workerd;
  the installed versions were approved with `npm approve-scripts workerd`, not by hand.

Decided by: Architect under standing orders.

## D-17 Test setup

- vitest 4.1.11 with `@cloudflare/vitest-pool-workers` 0.22.0 (the pool supports vitest ^4.1, not
  5). Two projects in vitest.config.ts: `unit` (Node: contracts, engine, UI helpers, eval replay)
  and `workers` (workerd: agent, Ledger, Quota, Workflow), with `remoteBindings: false`.
- `npm test` passes with an empty HOME and no Cloudflare credentials.
- Tests use `env` and `exports` from `cloudflare:workers`; the pool marks `env` and `SELF` from
  `cloudflare:test` deprecated. `cloudflare:test` stays the source for helpers such as
  `introspectWorkflowInstance`.
- `npm run eval:live` runs `vitest run --config evals/vitest.live.config.ts`, a config the evals
  lane creates; it is not part of `npm test`.

Decided by: Architect under standing orders.

## D-18 Contract and config details

- Tool inputs never carry a customer id: each `BillingAgent` instance is bound to one customer.
- The credit idempotency key is 64 hex characters: the agent derives it as SHA-256 of sandbox id,
  customer id, invoice id and disputed ledger entry id, so a retried claim maps to the same request.
- Binding names: `BillingAgent` (equal to the class, because the Agents SDK routes
  `/agents/billing-agent/...` by binding name), `LEDGER`, `QUOTA`, `CREDIT_WORKFLOW`, `RATE_LIMITER`,
  `AI`. Caps and timeouts are wrangler `vars`, parsed by `EnvConfigSchema`.
- `routeAgentRequest` maps every Durable Object binding by name (checked in the installed `agents`
  source), so `/agents/ledger/...` would reach the Ledger. The foundation router passes only
  `/agents/billing-agent/` to it, with a test; the agent lane keeps that guard.

Decided by: Architect under standing orders.

## D-19 Foundation fixes from PR #2 review, round 1

- Tier charges expose `unitPrice` as `Money` plus an engine-written `rateDisplay`; a contract test
  fails if any tool or HTTP output schema has a `*Cents` or `*Bps` field. Reason: raw prices would
  make the model convert (D-15).
- Both vitest projects load tests/setup/no-network.ts, which makes every global fetch fail; a test
  in each project proves it. Reason: `remoteBindings: false` keeps bindings local but does not stop
  an ordinary fetch.
- The root tsconfig excludes tests/agent, which has its own project with the `cloudflare:test`
  types; the foundation test imports `introspectWorkflowInstance` to keep that proven.
- There is no `computeCreditMemo`: `validateCreditClaim.creditableAmount` is the memo amount.
- tests/agent/tsconfig.json sets `exclude: []`: it inherited the root's exclusion of tests/agent and
  silently checked nothing (round 2). A planted type error in the Workers test now fails typecheck.

Decided by: Architect under standing orders.

## engine: Exact rational rating and line rounding

Accumulate tier charges with BigInt fractions and round once per line to the
nearest cent, ties away from zero; allocate tier residuals by cumulative
differences so displayed tiers reconcile. Reject unsafe integer results. Reason:
intermediate multiplication and independently rounded tiers must not lose cents.

Decided by: Engine engineer under standing orders.

## engine: Calendar proration and graduated segment tiers

Require exactly one subscription for every UTC calendar day; exclusive end dates
split plan segments. Prorate each fee by active days over calendar days, restart
graduated usage tiers per segment, and leave thresholds unprorated. Posted credits
in the rated month reduce the taxable subtotal, floored at zero for tax; pending
and void memos move no money. Reason: this gives an explicit reproducible rule
for first-day and last-day plan changes without inventing contract fields.

Decided by: Engine engineer under standing orders.

## engine: Issued comparisons and full-month simulation

Compare immutable issued invoices, expose meter deltas and signed non-usage
changes, and aggregate products in the engine-written summary. Simulate the
selected plan for the full month with the same usage and posted period credits;
actualPlanId names the issued invoice's closing plan after a change. Percent
displays round integer basis points to whole percentages; ratios use the absolute
prior amount, with a null percentage at zero. Multiples display hundredths with
trailing zeros removed. Reason: callers can copy grounded numbers without money
math and the frozen single-plan simulation field remains unambiguous.

Decided by: Engine engineer under standing orders.

## engine: Robust daily anomaly baseline and marginal usage cost

Use the leave-one-day-out monthly median for each meter, including missing days
as zero, with half-away rounding for an even median; score only positive
baselines, at 3x info, 4x warning, 5x critical. Estimate excess cost by re-rating
after removing only that day's excess, excluding fees, tax and credits. Reason:
a spike should not inflate its own baseline or be priced at the wrong tier.

Decided by: Engine engineer under standing orders.

## engine: Duplicate debit reservations and deterministic seed history

Match later charge postings by customer, invoice, amount and billing-run reference
ordered by timestamp then id. Merge dataset and caller memo snapshots by id,
reject conflicts or nonpositive amounts, and subtract pending plus applied
reservations; void memos release them. Seed one retried September debit, one 5x
spike, and a request that expires after 24 hours on October 2 with a void memo
and five ordered audit records. Derive internal invoice and line ids with 64-bit
FNV-1a to fit frozen slug lengths. Reason: seed history is clock-independent and
the demo debit remains available for a new credit request without double credit.

Decided by: Engine engineer under standing orders.

## engine: Review round 1 accounting and audit corrections

Ledger credit postings affect balance only; re-rating and simulation preserve
issued invoice discount lines instead of copying ledger credits into invoices.
This supersedes the earlier posted-credit invoice rule. The reproduced billing
cycle showed a 50-cent remedy also lowering the next invoice by 55 cents through
duplicated credit and tax effects. Reason: ledger remedies must move money once
and must not reduce tax on unrelated usage.

Use the caller's existingMemos status as the current transactional snapshot over
a stale dataset status, while still rejecting changed immutable memo fields.
Record the seeded requested-to-pending transition on its own request subject and
use the Workflow actor for each seeded Workflow step. Assert August's precise
total as well as the rounded change. Reason: legitimate status changes must work
and every claimed seed state and numeric result must have explicit evidence.

Decided by: Engine engineer under standing orders.

## engine: Current reservation snapshot is authoritative

The required existingMemos argument is the complete current pending/applied
reservation snapshot, per the frozen engine interface. Ignore dataset memo
history when reserving a debit, and reject conflicting duplicate memo ids within
the current snapshot. This supersedes the earlier dataset/caller merge rules.
Reason: round 2 reproduced a stale pending memo incorrectly blocking a new claim
after the live memo was voided and omitted from the current reservation list.

Decided by: Engine engineer under standing orders.

## engine: Deterministic daily usage shape with stable demo invoices

Rank UTC weekends below weekdays with deterministic customer/meter/date scores,
then allocate centered integer offsets and remaining units without changing
monthly totals. Keep each September plan segment separate for customer 2 and
lock the 15,000-unit September 18 spike with its 3,000-unit baseline. Set July
meter totals to 90 percent of August, floored to whole units, and bump the seed
to engine-v2. Reason: every customer/meter varies daily and July differs, while
all August/September invoices and the sole 5x anomaly remain unchanged.

Decided by: Engine engineer under standing orders.

## engine: Recover exact gate prompts from Claude session history

Read only the matched review sessions under ~/.claude/projects, identify them
by run directory, timestamp, review phase and reviewed commit ids, and copy
only each original user prompt into its existing 02g archive. Append recovery
entries to PROMPTS.md without copying other session messages or results.
Reason: the CLI review logs omitted prompt text, but the matched Claude sessions
contain it, as Anna requested for the PR follow-up.

Decided by: Engine engineer under standing orders.

## D-20 Credit confirmation on every path, including /turn

A credit request is a state-changing action, so it needs the customer's explicit confirmation on
every path. The chat confirms through the AI SDK `needsApproval` step. The non-streaming `/turn`
endpoint gets `confirm` (boolean, default `false`) in its request body (`TurnRequestSchema`): without
it a turn can only propose a credit request; with it a credit request started in that turn goes
ahead, and its `credit_requested` audit record shows that the customer confirmed and how. Reason:
the eval harness must exercise the same policy as the product, not a bypass. This changes a
contract frozen at Stop 2, so it lands on main as its own PR before the agent lane rebases onto it.
Not chosen: skipping confirmation on `/turn` (the agent lane's first proposal) and requiring
confirmation everywhere with no way to give it over `/turn`.

Decided by: Anna.

## agent: the engine runs inside the Ledger

Tool reads, the panel and credit validation call the engine inside the `Ledger` Durable Object,
next to the data, and return contract outputs; the agent validates each output against its tool
schema. The immutable seed tables are cached per instance; ledger entries, requests and memos are
read fresh. Reason: one source of truth, and no dataset shipped over RPC per tool call.

Decided by: Agent engineer under standing orders.

## agent: admission without writes

`seed()` is the only code that creates the Ledger schema. Admission is a read of `sqlite_master`
plus the `meta`, `customers` and `counters` rows; a refusal (404, 401, 429) writes nothing, and an
admitted request increments the daily API counter and the last-activity time. Every
sandbox-scoped route counts, including the agent WebSocket upgrade and agent HTTP requests
(`onBeforeConnect`, `onBeforeRequest`); chat messages after connect are capped by the message cap
instead. The approver token is checked in the Ledger by comparing SHA-256 digests with
`crypto.subtle.timingSafeEqual`. Reason: fabricated ids must cost no storage (D-12).

Decided by: Agent engineer under standing orders.

## agent: credit request ids and duplicate handling

- The request id is `cr_` plus the first 24 hex characters of the idempotency key, and the
  Workflow instance id is the request id. Reason: a retried claim maps to the same request and the
  same instance; recovery and tests can compute the id.
- A retried key returns the recorded request whatever its status, including a terminal one. A
  customer cannot re-file the identical claim after it expired or was rejected. Reason: idempotency
  first; the demo never needs a second attempt on the same charge.
- "A second open request for the same charge returns the first": an open request on the same
  invoice matches when either side names no disputed entry, because the charge is only known after
  validation. Reason: the conservative reading; the reservation in `createPendingMemo` remains the
  hard guarantee.
- `validate` records the validated amount and the resolved disputed entry (audit
  `credit_validated`) without changing status; `createPendingMemo` re-runs
  `engine.validateCreditClaim` against every pending and applied memo inside its transaction and
  either reserves (memo `pending`, status `pending_approval`, audit `memo_pending`) or rejects
  (`credit_validation_failed`). Reason: the reservation check and the write must be one
  transaction.
- A replayed approve after the credit was applied is "already", not a refused transition.

Decided by: Agent engineer under standing orders.

## agent: Workflow behaviour and the waitForEvent timeout error

- Each step returns the Ledger's current state, so a restarted instance resumes wherever the
  request is (validate, memo, wait, or straight to settling a recorded decision).
- The approval event is only a wake-up: after the wait the Workflow reads the recorded decision
  (`read-decision`), and on timeout the `expire` step expires only when no decision is recorded.
  A wake-up without a recorded decision leaves the request pending for the sweeper.
- Measured in local dev (vitest-pool-workers, `forceEventTimeout`): `waitForEvent` throws
  `WorkflowTimeoutError: Execution timed out after 86400000ms`. The Workflow still catches any
  error from that one call; the name is reported in the instance output (`waitError`). Settles
  the open question in the DEV table for local dev; production is not verified.
- Progress goes to the agent with `reportProgress`, which broadcasts
  `{ type: "credit-request-update", requestId, status }` to connected chat clients (best effort,
  outside the contracts; the UI may refresh the panel on it).

Decided by: Agent engineer under standing orders.

## agent: recovery details

- An instance blocked in `waitForEvent` reports `running` in local dev, although `InstanceStatus`
  in the installed types includes `waiting`. The sweeper therefore resends the approval event to
  any live instance (`queued`, `running`, `waiting`, `paused`, `waitingForPause`); an instance not
  yet waiting buffers it. A request whose instance is gone, complete or failed is finished through
  the Ledger transitions.
- A missing instance for a `requested` request is created with the same params `runWorkflow`
  builds (`__agentName` and the rest, which `AgentWorkflow` requires); `errored` or `terminated`
  instances are restarted. Both write `workflow_restarted` (the audit enum has no separate "started"
  action). The agent's own restart on "already exists" (D-9) is audited the same way.
- A request still `requested` an hour after creation, or decided but unfinished 30 minutes after
  the decision, is driven through the Ledger transitions directly even if its instance reports a
  live state (for example paused). Reason: a stuck instance must not strand a request or keep the
  sweeper re-driving it forever; racing a live instance is safe because every transition is
  idempotent.
- Recovery actor is `system:sweeper`; Workflow-timeout expiry is `system`.

Decided by: Agent engineer under standing orders.

## agent: approver identity

Decisions are recorded with actor `approver:<sandboxId>`: `ActorSchema` requires 32 hex
characters, and a sandbox has exactly one approver token (D-4). Reason: stable and meaningful
without exposing any part of the token or its hash.

Decided by: Agent engineer under standing orders.

## agent: /turn runs the chat path headless

`POST .../turn` submits the user message through `saveMessages`, so it runs the same
`onChatMessage` (caps, budget, tools, history) and lands in the same persisted conversation. The
agent marks the message as headless in server memory (a set of message ids filled only by
`headlessTurn`); message metadata is client-controlled and is never trusted for this. Refusals
before any model call return the contract error (429 `cap_reached` or `budget_exhausted`); a turn
whose later step hit the budget returns 200 with the fixed text.

Credit confirmation follows D-20 (decided by the owner). The per-message record also holds the
request's `confirm` flag. Without it the turn runs with the same `needsApproval` step as the chat,
so the model can only propose a credit request; `/turn` reports it as a `startCreditRequest` call
with no output and the error "Awaiting the customer's confirmation...". With `confirm: true` a
credit request started in that turn goes ahead. A proposal left unanswered from an earlier turn is
closed before the next one; in a confirmed turn the model is told it was not started yet and to
call the tool again. The `credit_requested` audit record reads "Confirmed by the customer in the
chat" or "... via /turn (confirm: true)", and its `after` carries `confirmedBy: "customer"` and
`confirmedVia`. Each turn works from one snapshot of the conversation taken when it starts; the
confirmation, the cap exemption and the model context all come from it, so a message the client
adds while a confirmed turn runs cannot ride on its confirmation (PR #4 review round 4). Reason:
one policy on every path, visible in the audit trail.

Decided by: Agent engineer under standing orders (the mechanics; the policy is D-20, decided by
Anna).

## agent: model settings, budget estimate and history

- `temperature: 0`, `maxOutputTokens` from `MAX_OUTPUT_TOKENS`, `stopWhen: stepCountIs(4)`.
- The budget middleware sits inside `simulateStreamingMiddleware` (the simulated stream calls
  `doGenerate`, which it wraps). Input tokens are bounded by the UTF-8 byte length of the
  serialised prompt and tool definitions plus 8 template tokens per message (Llama 3's tokenizer
  is byte-level BPE: a text token covers at least one byte), output by `maxOutputTokens`; a failed
  call is settled at its estimate, and actual usage above the estimate is recorded, never clamped,
  and logged. Reason: the reservation must be a true upper bound for the stop to hold (PR #4 review
  round 1); it over-reserves about 3 to 4 times and is settled right after the call.
- A call whose usage is missing or zero (the provider reports absent usage as 0) is settled at
  its bound for the missing part, never as free. Reason: an unreported call must not release its
  reservation (PR #4 review round 2).
- Only a continuation that resumes a server-issued credit confirmation the customer just answered
  is exempt from the message cap, once. Any other continuation, such as an approval frame for an
  unknown, forged or already-answered tool call (which the SDK still continues), is charged as a
  message. Reason: fabricated frames must not buy model calls past the cap.
- History sent to the model: tool calls older than the last two messages pruned, then oldest
  messages dropped until an estimated 12,000 tokens remain, starting at a user message. A credit
  confirmation left unanswered when the customer types something else is closed as denied.
- Memory, in the agent's SQLite: customer name and plan name (from `getAccount`), the last 8
  questions (160 characters each) and credit request ids started in the chat. No amounts are
  stored; the prompt says memory is context only and numbers are fetched again.
- Tool failures reach the UI stream as message strings. Every tool turns unexpected errors into a
  generic `ToolError` (logged), so the text shown is either an input-validation message or the
  tool's own refusal.

Decided by: Agent engineer under standing orders.

## agent: storage sizing and deletion

`usage_daily` and the other composite-key tables are `WITHOUT ROWID`, so each insert is one
b-tree write. Seeding and deletion sum SQLite's `rowsWritten` per statement; idle deletion runs a
`DELETE` per table (measured), then `deleteAlarm` and `deleteAll`. The agent deletes itself with
`Agent.destroy()` from an SDK schedule after `SANDBOX_IDLE_DAYS` without a message; `onStart`
keeps exactly one pending `idleSweep`, so an agent that is only connected to, or whose first
message is refused, is deleted too. Reason: D-7 asks for measured rows written for both phases,
and no agent storage may outlive its idle period.

Decided by: Agent engineer under standing orders.

## agent: HTTP details

- `POST /api/sandboxes` answers 201 with `Cache-Control: no-store` (the approver token is in the
  body). The per-IP sandbox counter is keyed by SHA-256 of the UTC day and the IP, so stored
  hashes do not link across days.
- The rate limiter keys on `CF-Connecting-IP` (`unknown` when absent, as in local dev) and runs on
  every `/api/*` and `/agents/*` request except `/api/health`, the readiness probe, which touches
  no Durable Object and never calls the model.
- A known path with the wrong method answers the contract 404 (`ErrorCodeSchema` has no 405).

Decided by: Agent engineer under standing orders.

## agent: installed types versus the DOM lib for timingSafeEqual

`crypto.subtle.timingSafeEqual` is declared in the installed workerd types (env.d.ts), but the
root tsconfig also loads the DOM lib, whose `SubtleCrypto` hides it. The code calls it through a
narrow typed view. Reason: installed types win; no config change needed.

Decided by: Agent engineer under standing orders.

## agent: test design

Workers tests replace `src/engine` with a schema-valid fake through `vi.mock` (it reaches code
inside Durable Objects, checked), so the agent lane's tests do not depend on the engine lane's
numbers. The AI binding is stubbed by replacing `env.AI.run` with scripted Workers AI replies,
which exercises `workers-ai-provider` and the middleware stack. The one test that needs the real
seed (rows written for seeding and deletion under 2,500) skips while `engine.seed()` is the stub.

Decided by: Agent engineer under standing orders.

## agent: the server owns tool history

The Agents SDK accepts conversation history from the client (`cf_agent_chat_messages` and the
messages in each chat request). The agent records, in its own SQLite (`issued_tool_calls`, newest
1,000 rows), every tool call it issues (id, tool name, SHA-256 of the canonical input, and whether
it awaits the customer's confirmation), every output its tools return (SHA-256) and the text of
every tool failure. All writes are upserts, because the AI SDK executes a tool before the step's
`onStepFinish` runs. Before each model call, the history sent to the model keeps a tool part only
in a state the server produces: an output whose hash matches, an error whose text is replaced by
the server's recorded text (a generic text if none), or a confirmation state for a call the server
issued for confirmation; anything else is dropped. So a forged "approved" confirmation never
executes and a forged tool result or error never reaches the model as grounding. A table created
before `error_text` existed gains the column in place, keeping its rows. Assistant and user text is
not filtered: it carries no tool authority. Reason: grounding (every number from a
real tool result) and the message cap must not depend on client honesty (PR #4 review rounds 2
and 3).

Decided by: Agent engineer under standing orders.

## agent: the server runs the anomaly check for every invoice a turn touches

User story 4 asks the copilot to mention the September spike proactively; in the live run Llama 3.3
did not call `detectAnomalies` although the prompt asked it to. Now, when a `getInvoice` or
`explainLineItem` result is produced for a period with no successful check yet in the turn, the
server runs `detectAnomalies` for that period at once (src/agent/anomalies.ts):
- The server-issued call and its result are written to the chat stream immediately, so they are
  stored, shown in the UI and in `/turn`, and recorded in provenance.
- The pair is given to the model before its next step (`prepareStep`, re-inserted at the same
  position on every later step).
- If the invoice came on the turn's last allowed step, the stop condition allows one extra answer
  step, and only then; the hard cap is `MAX_STEPS + 1` model calls, each still budget-reserved.
- A model-issued check of the same period (in flight or earlier) suppresses the server check only
  if it succeeded.
- A failed server check is shown to the model and in the transcript as an error result, and is
  retried once on the next trigger in the turn (at most two attempts per period).

The prompt tells the model to mention any spike the result reports. The tool already exists, so no
contract changes. Reason: the check must not depend on the model's choice (PR #4 review round 5
found the last-step and failure gaps in the first version).

Decided by: Anna (the requirement); Agent engineer under standing orders (the mechanism).

## ui: Fixture transport and live handoff

The UI defaults to a clearly labelled fixture preview until the agent HTTP surface merges; set
`VITE_BILLING_API_MODE=live` for the real fetch client and `useAgentChat`. Both transports pass
through the frozen response schemas. Fixture and live sessions use separate storage keys so a
preview sandbox can never be sent to the live API. Fixtures illustrate the interface rather than
claim to be the engine's seed; they never calculate amounts. Reason: the UI lane can be exercised
without server changes or model calls while the agent lane is still being built.

Decided by: Frontend engineer under standing orders.

## ui: Approval links and refresh boundaries

Approval links carry both sandbox id and token in the fragment, which the admin page removes on
entry. Requests send the token only in the Authorization header. A saved session restores access
on reload; an invalid fragment fails explicitly. Both admin decisions require a reason, matching
the frozen DecisionRequest schema. Customer changes and resets remount the workspace; generation
counters discard stale responses. Panels refresh on chat completion, window focus, or an explicit
Refresh action instead of polling against the 200-request daily cap. Reason: keep customer state
isolated, keep credentials out of request URLs, and conserve the sandbox's request budget.

Decided by: Frontend engineer under standing orders.

## ui: Local fixture evidence without remote bindings

Run the existing dev command with `CLOUDFLARE_VITE_FORCE_LOCAL=true` to disable remote bindings
using the installed Cloudflare Vite plugin's supported environment override. In a restricted
workspace, also set `XDG_CONFIG_HOME` to a temporary writable directory for Wrangler's local
registry. No frozen configuration changes or credentials are required. The browser evidence
script uses the already installed external Playwright runtime and is excluded from the offline
vitest patterns. Reason: capture the actual app through npm run dev without contacting the model.

Decided by: Frontend engineer under standing orders.

## ui: Evidence kept out of deployed static assets

Done-contract evidence (screenshots, command logs, browser checks) lives in `tests/ui/evidence/`,
written there by `tests/ui/browser-evidence.mjs`. It was first placed in `public/ui-evidence/`,
which is both Wrangler's assets directory and Vite's publicDir, so it would have been served on
the deployed site. Absolute home paths and temporary config-directory paths are scrubbed from the
logs. Reason: gate review round 1 found the evidence would be published with local paths.

Decided by: Frontend engineer under standing orders.

## ui: Shared engine seed is the preview source

The preview creates its mutable dataset with engine.seed() and derives customer names, plans,
invoices, balances, comparisons, simulations, anomalies and validated credits through the shared
engine. Approval copies the validated memo into the credit ledger; engine.balance computes the
result and the issued invoice stays unchanged. Historical request and audit records come from the
seed, scoped to the selected customer. A new fixture storage namespace discards older hand-made
sessions; live storage remains compatible. This supersedes the earlier rule that fixtures only
illustrate the interface and are not the engine's seed. Reason: Anna requested preview values and
evidence that match the live demo with one source for every number. No engine, contract, dependency
or configuration changes.

Decided by: Frontend engineer under standing orders.

## ui: Synchronize the gate's published rebase

The pinned gate refused synchronization because the clean local and published heads had diverged
after its rebase onto the engine merge. A range-diff confirmed the UI patches were preserved.
With Anna's explicit approval, refs/no-mistakes/manual-sync/ui-before-seed-followup preserves the
old head and the worktree moved to published head 056a7a4 before follow-up commits. Reason: retain
the gate fixes and merged engine while preserving the original head for inspection.

Decided by: Anna.

## ui: Preview chat simulates a plan only when a seeded plan is named

Reason: gate review round 1 found substring matching sent words such as "problem" to plan simulation or an error, so the preview now matches seeded plan names as whole words and otherwise answers with the invoice. Decided by: Frontend engineer under standing orders.

## ui: Rebase onto the agent merge keeps both sides of the logs

Rebasing PR #5 onto main after PR #4 merged conflicted only in the append-only PROMPTS.md and
docs/DECISIONS.md. Each conflict was resolved mechanically by keeping the main-side agent records
first and the UI-side records after them, closing the open prompt fence between them, with no text
removed or rewritten on either side. Reason: both logs are append-only and Anna asked for both
sides to be kept.

Decided by: Frontend engineer under standing orders.

## ui: Refresh command evidence after the agent merge

The command logs and test collection under tests/ui/evidence were regenerated from real runs on
the rebased head instead of being hand-edited: 223 tests pass, and the collection grows from 190 on
main 2af8f1d to 223, adding the 33 UI tests and removing none. The screenshots and defect proofs
are kept because the rebase left src/ui, tests/ui and index.html unchanged. Reason: the evidence
must describe the checkout under review, and command output must come from the commands.

Decided by: Frontend engineer under standing orders.

## evals: early-start synthetic fixtures and strict replay provenance

Build fifteen cases from the current engine seed with engine-computed expected amounts,
and label pre-agent recordings `synthetic-engine` with no timestamp or model usage. Replay
validates each tool input/output and checks expected displays, semantic phrases, and money
and numeric provenance using only current and earlier recorded tool outputs. Reason: the
owner authorized offline work before PR #4 merges, and synthetic harness evidence must not
be reported as live model performance. Decided by: QA engineer under standing orders.

## evals: memory turns and credit confirmation

Each memory case sends a new HTTP request without client history to the same sandbox/customer;
only credit-start questions send `confirm: true`, and September invoice/change cases require
the proactive anomaly without asserting that the model selected detectAnomalies. Reason:
this exercises persisted context and D-20 while respecting the agent lane's deterministic
anomaly behavior. Decided by: QA engineer under standing orders.

## evals: bounded live capture with honest capacity results

Use a separate opt-in live config, HTTPS origin from the environment, one fresh sandbox per
case, sequential requests without retries, and immediate stop on caps or other request failures.
Persist UTC date, pass fraction over all planned cases, completed counts and reported token/
model-call usage; discard approver tokens. Require an explicit readiness acknowledgment after
the owner's merge notice, pull and deployment. Reason: fresh cases avoid shared state, while
D-7's five-sandbox-per-IP cap must stay enforced and partial results cannot claim completion.
Full-run capacity is an owner decision, not a cap bypass in the evals lane.
Decided by: QA engineer under standing orders.

## evals: natural calendar dates in replay grounding

Replay normalizes named calendar dates in answers to ISO before the expected-value and numeric
provenance checks, grounds bare years from tool dates/periods, resolves a yearless day only from
a single grounded period for its month, and reports unresolved named days. The replay test title
reports live versus synthetic-engine recording counts. Reason: gate review round 1 (F1) showed
natural wording such as "September 2026" or "September 18" failed as ungrounded numbers and missed
the expected ISO anomaly date, which would count correct live answers as failures; whole-date
matching keeps a fabricated date from passing on separately present parts, and the source count
keeps a capped mixed snapshot from reading as live coverage (F2).
Decided by: QA engineer under standing orders.

## evals: calendar dates from tool timestamps

Replay's numeric pattern also reads the UTC calendar date that begins an ISO timestamp (for
example `2026-10-04` from `2026-10-04T00:00:00Z`), so credit deadlines and creation dates quoted
in prose ground as whole dates. Reason: gate review round 2 (R2-F1) showed the `T` separator
dropped the day, so a correct "approval deadline October 4, 2026" failed as ungrounded; any
other day is still rejected. Decided by: QA engineer under standing orders.

## evals: preserve gate fixes when starting the owner-authorized live phase

Recover the cancelled offline gate's two fix commits with `no-mistakes axi sync --recover`
before rebasing onto merged PR #4. Reason: the owner's new live-capture and count-grounding
scope supersedes the offline-only gate intent, and the new validation must retain its fixes.
Decided by: QA engineer under standing orders.

## evals: owner-authorized local capture, sandbox grouping and bounded reruns

Capture one full local-dev set, then one explicit rerun of its failing questions; share only
read-only cases, isolate credit and memory cases, and reuse known sandboxes for the rerun.
Default EVAL_BASE_URL to loopback dev and persist target, date, model calls and estimated
neurons per run. Reason: Anna authorized local dev before release deployment and required
respecting caps rather than raising them. Decided by: Anna.

## evals: every numeric claim includes contextual counts and date wording

Ground array lengths and numbered positions, parse written integer numbers, and require invoice
line-count claims to match the invoice array rather than any unrelated scalar. Derive month/year
from full tool timestamps and keep full dates coherent. Keep failed live answers as red replay
cases; regression tests start from engine fixtures in memory. Reason: the owner reported "7
lines" for a six-line invoice and asked for every number to be checked.
Decided by: QA engineer under standing orders.

## evals: offline correction of ISO-month count false positives

Exclude ISO date components from count-claim starts. Preserve initial grading and all original
responses, then regrade the archived full run offline. Reason: the first capture proved that
"2026-09 invoice" was incorrectly recognized as "09 invoices"; correcting that checker defect
changes the first-run grade from 4/15 to 6/15 without a new model call or a weakened count check.
Decided by: QA engineer under standing orders.

## evals: rejected calls can recover but cannot ground answers

Validate successful tool inputs and outputs strictly. Validate rejected-call envelopes, require
null output, and exclude rejected inputs and outputs from all grounding evidence; allow a later
successful call to recover. Require a successful startCreditRequest receipt for confirmed credit
turns. Reason: real plan-memory captures recover from an invalid plan id and answer correctly,
so failing solely on the rejected call misgraded valid behavior. The credit capture also recovers
its tools but fails because its answers are empty. Preserve all prior grades and responses when
regrading offline. Decided by: QA engineer under standing orders.

## evals: test harness stability instead of model perfection

Replay regrades all active and archived recordings and compares exact verdicts/issues with
committed results. Known-good and known-bad grader unit tests remain independent. Model failures
are negative reported verdicts, not failing tests. Reason: Anna requires a green harness gate
without letting its automatic test fix alter grading or recordings to improve model results.
Decided by: Anna.

## evals: explicit all-recordings grading with raw/corrected reporting

An offline, opt-in generator applies one shared grader to every recording, preserves capture-time
and intermediate grades, checks active copies are the latest attempts, and writes corrected
results plus recording digests. Tests never regenerate results. Reason: Anna requires every
correction to have a unit regression and a visible full-recording result diff, with no per-answer
override. Capture archives use run start time separately from individual case timestamps.
Decided by: QA engineer under standing orders.

## evals: gate retry after the harness passes

Update only the stale local gate branch ref, retaining its old head, and retry gated delivery
after npm test is green. Reason: Anna explicitly authorized this ref update and PR creation
with the results labeled local dev; no merge or deployment is authorized. Decided by: Anna.

## evals: per-turn grounding with echoed dates

Money amounts, percentages, counts and other numbers in an answer must come from that turn's
successful tool outputs; an amount the customer typed or an earlier turn's result is not
evidence. Dates and billing periods may come from that turn's tool outputs or the customer's own
message, compared after normalizing formats, and message dates never ground numbers. Reason:
the runtime grounding guard will enforce the same rule, and a wrong premise repeated back must
fail while an echoed period must not. Applied to every recording by explicit offline regrade.
Decided by: Anna.

## evals: standing orders while Anna is away

Proceed within lane decision rights and log each choice. Reserved decisions (merge, deploy,
login, secrets, force-push to main, account and contract changes) go on a FOR ANNA list instead
of blocking other work; do not log in if wrangler authentication fails. Finish the grading rule,
gated push and PR, then stop. After the PR opens, preserve published feat/evals history for the
agent-fixes lane unless the gate itself requires a rewrite, which must be reported. Reason: Anna
is away for about five hours and merges on return. Decided by: Anna.

## agent: runtime grounding guard

Before a reply leaves the agent, `src/agent/guard.ts` checks it with the eval grader's rule (owner
decision): every money amount, percentage, count and other number must appear in that turn's
successful tool outputs (model-issued, server-issued anomaly checks, and a continuation's earlier
steps after the last customer message); dates, billing periods and years may also come from the
customer's message. `src/agent/grounding.ts` is a copy of the grader's tokenising
(`evals/grounding.ts`, money, number words, counts against array lengths, named dates) because
`src/` must not import `evals/`; it differs only in scoping evidence to the turn and in accepting
the customer's dates.

- The reply text is held back while the turn runs (tool parts still stream) and sent once checked.
  With simulated streaming (D-14) each step's text arrived in one piece anyway.
- An unsupported draft gets exactly one retry: the same context (server checks included), the
  draft, and a user-role correction naming each unsupported figure, with no tools, so the retry
  restates what the turn fetched and cannot start a new tool loop. It is one more budget-reserved
  model call (worst case `MAX_STEPS + 2` per turn).
- If the retry is still unsupported, empty or refused by the budget, the customer gets the reply
  with every sentence carrying an unsupported figure removed plus a fixed note, or a fixed safe
  answer (no figures) when nothing verifiable is left.
- A turn that hit the neuron stop sends the fixed budget message unchecked (outcome `budget`).
- The outcome (`grounded`, `corrected`, `safe_answer`, `budget`, with the unsupported figures of
  the draft and the retry) is written as the assistant message's metadata, so it is stored with
  the turn, and logged when not `grounded`. It is not in the `/turn` response: `TurnResponseSchema`
  is a frozen contract (listed for the owner).

Reason: the evals found ungrounded figures reaching customers (for example "7 lines" for a
six-line invoice); a prompt rule alone does not stop them. Not chosen: retrying with tools (a
second loop with its own grounding question) and silently dropping figures without a retry.

Decided by: Agent fixes engineer under standing orders.

## agent: unknown-id errors name the real ids

In the evals Llama 3.3 called `explainLineItem` and `startCreditRequest` with invented ids
(`inv_1234567890`, `inv_202609`) and then gave up. An unknown invoice id now gets an error listing
the customer's invoice ids with their periods and pointing to `getInvoice`; an unknown line id gets
the invoice's line ids with their descriptions. The prompt says to call `getInvoice` before
`explainLineItem` and to retry with the listed ids. The ids are the customer's own, already
returned by `getAccount`. Reason: give the model the exact value it needs to recover, instead of
a dead end. Not chosen: guessing the intended invoice server-side (no reliable signal).

Decided by: Agent fixes engineer under standing orders.

## agent: repair plan ids written in display case

In the evals Llama 3.3 called `simulatePlan` with `plan_Pro` and `plan_Scale`; the contract's
lowercase slug rejects them, and it repeated `plan_Scale` after `getAccount` had returned
`plan_scale`. The agent now passes `experimental_repairToolCall` to `streamText`: a `simulatePlan`
call that fails input validation is rewritten only when its `planId` names exactly one of the
customer's available plans (from the Ledger's `account` read), ignoring case, spaces, hyphens and
the `plan_` prefix, by id or by name. The repaired input is then validated with the contract
schema as usual; no match, or two matches, stays a validation error. The prompt also asks for the
id copied exactly, in lowercase. Reason: the intent is unambiguous and the mapping is a lookup, not
a guess; the contract stays strict. Not chosen: loosening the schema (frozen contract) or relying
on the prompt alone (it already said to use availablePlans).

Decided by: Agent fixes engineer under standing orders.

## agent: comparisons trigger the server's anomaly check

The evals' August-to-September comparison never mentioned the September spike: the server check
(see "the server runs the anomaly check for every invoice a turn touches") only fired on
`getInvoice` and `explainLineItem`. A `compareInvoices` result now triggers it for both months, the
later month first, with the same once-per-period and retry rules; the prompt says to mention a
reported spike when explaining a change. Reason: a spike in either month can explain the change,
and the check costs no model call.

Decided by: Agent fixes engineer under standing orders.

## agent: the last step answers, and an empty reply is asked for once

In the evals the credit turns ended with no text (remember-credit): Llama 3.3 spent all four steps
on tool calls, including four identical `getCreditRequestStatus` calls. Now:

- `prepareStep` gives a step no tools (`activeTools: []`) when it is the last allowed step, or when
  the previous step only repeated calls already made in the turn (same tool and canonical input).
  A tool call the model still emits on such a step is refused by the SDK and not executed.
- An empty draft, unless the turn stopped at a credit proposal awaiting the customer's
  confirmation, goes through the grounding guard's one retry with an "answer now" instruction. A
  grounded answer is sent (outcome `completed`); an ungrounded one becomes the safe answer; an
  empty one becomes a fixed "could not finish" message (outcome `incomplete`).
- The prompt asks for the amount and approval status once a credit result is in, and not to
  fetch the same result again.
- This supersedes the extra answer step in "the server runs the anomaly check for every invoice a
  turn touches": with no tools on the last step, no server check can arrive after it, so the
  `MAX_STEPS + 1` allowance was unreachable and is removed. The cap per turn is `MAX_STEPS` steps
  plus the guard's one retry. Two tests that scripted a tool call on the last step were rewritten
  to the new guarantee, and a chat provenance test's script was reordered so its repeat comes last.

Reason: a turn must end with an answer the customer can read, inside the same model-call cap.

Decided by: Agent fixes engineer under standing orders.

## agent: the guard follows the grader's final per-turn rule exactly

After rebasing onto the evals PR, `src/agent/grounding.ts` mirrors the grader's final rule
("evals: per-turn grounding with echoed dates"): tool dates and periods are kept apart from other
numbers and ground only date-shaped tokens; the customer's message grounds ISO dates, periods and
an echoed yearless date, never a bare year, money, percentage or count.
`tests/agent/grounding-parity.test.ts` runs the guard and `evals/grounding.ts` over every committed
recording (active and archived) and requires the same flagged figures on every turn; removing
message dates from the guard turns seven of them red. Reason: "using the same rule as the grader"
must be checked, not assumed, while the code exists in two copies.

Decided by: Agent fixes engineer under standing orders.

## agent: an answer step sends no tools field

Found in the live rerun: with `activeTools: []` the AI SDK passes an empty tool list,
`workers-ai-provider` forwards it, and Workers AI refuses the call (error 8007, "`tools` must not
be an empty array"), so the answer step failed and remember-credit still ended empty. A model
middleware (`noEmptyToolsMiddleware`) now drops an empty `tools` list and its `toolChoice` before
the call. The test stub of the AI binding refuses `tools: []` the same way, so the tests catch a
regression (three go red without the middleware). Reason: the offline stub accepted a request the
real binding rejects; it now mirrors that constraint.

Decided by: Agent fixes engineer under standing orders.

## agent: guard evidence is server-owned, not read from history positions

Codex review round 1 found that the guard took a continuation's earlier tool outputs from the
messages after the last customer message, positions a client controls. Now a run that stops at
a credit proposal stores its outputs server-side (`awaiting_evidence`, keyed by the proposed tool
call ids); the next run uses them only if it is a continuation whose last assistant message holds
one of those calls, and the stored row is cleared at the start of every run. Every other run cites
only its own outputs. Observed while testing: the SDK's persistence currently merges a moved tool
part back into its original message by call id, so the end-to-end replay did not reproduce;
the rule no longer depends on that. Also from this round: a retry call that throws now falls back
to the safe answer instead of erroring the turn.

Decided by: Agent fixes engineer under standing orders.

## agent: stored evidence needs the customer's answer to that proposal

Codex review round 2 reproduced a continuation that was not a confirmation (a client
`cf_agent_tool_result` frame putting the proposal into `output-error`) reusing the proposing run's
stored evidence. Now `consumeAnsweredConfirmation` returns the consumed tool call id, and the
stored evidence applies only when that id is one of the stored proposals and the run answers the
same customer message (`userMessageId`); the stored question text is used for date evidence.
The row is read and cleared at the very start of every run, before any cap refusal, so a refused,
abandoned or unrelated run cannot leave it for a later one. An end-to-end WebSocket test with the
tool-result frame goes red on the round-1 code.

Decided by: Agent fixes engineer under standing orders.

## D-7 amendment: 20 new sandboxes per IP per UTC day

The per-IP cap on new sandboxes rises from 5 to 20 per UTC day (`SANDBOXES_PER_DAY_PER_IP`). The
global cap of 200 new sandboxes per UTC day and every per-sandbox cap (30 messages, 5 credit
requests, 200 API requests) stay as they are. Reason: several reviewers behind one office or VPN
address would lock each other out after five sandboxes, and one full eval run needs about five on
its own (the agent-fixes lane's live runs hit the cap on 2026-10-01). The cost estimate does not
change: it already assumes the global cap saturated every day, and the global cap still binds. What
changes is how fast one address can use it up: 10 addresses can now take the day's 200 sandboxes,
against 40 before.

Decided by: Anna.
