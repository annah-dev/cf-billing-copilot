# Build plan

Agent-operational. Product design is in docs/ARCHITECTURE.md and docs/DECISIONS.md; this file only
says who builds what, where, in which order, and how each lane starts and is reviewed. Directory
names follow the agents-starter layout and are confirmed at Stop 2.

## Sequence

1. Stop 1 (Architect, Claude Code): this plan. Docs only.
2. Stop 2 (Architect, Claude Code): foundation on main. Scaffold, repo rules, contracts, wrangler
   config with every binding, vitest + CI, no-mistakes config, Llama 3.3 tool-call round trip, lane
   prompts. After it merges, `src/contracts/`, `wrangler.jsonc`, `package.json` and the test config are
   frozen.
3. Parallel burst: engine, agent and ui start together from the Stop 2 main.
4. Merge order: engine, then agent (rebased on engine), then ui. The owner deploys after ui merges.
5. evals starts after engine and agent merge (it needs real tools and the `/turn` endpoint).
6. release starts last, after evals merges.

## Shared files nobody owns during the burst

`src/contracts/`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `vitest.config.ts`,
`tsconfig.json`, `.github/`, `AGENTS.md`, `CLAUDE.md`, `docs/agent/verification.md`,
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md`. A lane that needs one of these changed (a contract is
wrong, a dependency is missing, a binding is missing) stops, says so, and the fix goes to main as
its own PR that every open lane rebases onto. Every lane may append its own prompt and outcome to
`PROMPTS.md`; on rebase, keep both sides' entries in timestamp order.

## Lanes

### engine (Codex)

- Owns: `src/engine/` (including `src/engine/seed/`), `tests/engine/`.
- Must not touch: anything outside those, and must not import `cloudflare:*`, `agents`,
  `@cloudflare/*`, `ai` or `workers-ai-provider`.
- Builds: rating with tiers, proration on a mid-cycle plan change, tax, invoice build,
  `explainLineItem`, `compareInvoices` (per-product deltas), `simulatePlan`, `detectAnomalies`,
  `validateCreditClaim`, `computeCreditMemo`, and the deterministic seed: 3 fictional customers,
  July to September 2026 daily usage on 4 meters, 3 tiered plans, one invoice per month, one
  duplicate charge in September, one 5x one-day spike on one meter in September, one historical
  expired credit request. Seed target for the demo script: customer 1's September invoice totals
  41287 cents and is 38% above August (rounded to a whole percent).
- Done: every function implements the engine interface in `src/contracts/` and its outputs parse
  with the contract schemas; integer cents only (a test fails on any non-integer amount); tests
  cover tier boundaries (exactly at, one below, one above), proration on the first and last day,
  rounding of fractional cents with the documented rule, tax, zero usage, the duplicate and spike
  detection, and seed determinism; a test asserts no forbidden import under `src/engine/`;
  `npm test` passes; the PR carries the evidence docs/agent/verification.md requires.

### agent (Claude Code)

- Owns: `src/server.ts`, `src/agent/`, `src/ledger/`, `src/workflows/`, `src/http/`, `src/quota/`,
  `tests/agent/`.
- Must not touch: `src/engine/` (reads only), UI files, `evals/`.
- Builds: `BillingAgent` (`AIChatAgent`) with the 8 typed tools on Llama 3.3, history trimming and
  memory; `Ledger` DO with the schema, seeding from the engine, state machine, idempotency, audit
  log, epoch, deadline sweep alarm and idle deletion; `CreditRequestWorkflow` (`AgentWorkflow`) with
  validate, pending memo, `waitForEvent`, apply, reject, expire; `Quota` DO; every HTTP endpoint in
  docs/ARCHITECTURE.md with the approver token check and caps.
- Done: workers-pool tests with a stubbed AI binding prove: bad tool input is rejected by zod; the
  flow request, pending, approve, applied, with audit records in order; reject; timeout to expired
  with its audit record; a late approval refused with 409 and audited; a retried idempotency key
  returns the same request and never a second credit; reset restores the seed and a straggler
  Workflow from the old epoch cannot write; missing or wrong token gets 401; caps return the fixed
  message without a model call. Evidence also includes one local-dev chat turn against real Llama
  3.3 (a few calls, not a loop) and the credit flow driven by curl in local dev.

### ui (Codex)

- Owns: `src/app.tsx`, `src/client.tsx`, `src/ui/`, `src/admin/`, `src/styles.css`, `index.html`,
  any admin HTML entry, `public/`, `tests/ui/`.
- Must not touch: server code, contracts, engine, evals.
- Builds: chat page (Agents SDK `useAgentChat`), side panel with the current invoice, credit
  requests and audit trail, confirmation UI for `startCreditRequest` (`needsApproval`), the
  sandbox bootstrap and "Reset demo", the `/admin` page (list, approve, reject with reason), and
  clear states for caps, budget exhaustion and errors. The UI formats cents; it never computes
  money.
- Done: works against the HTTP contract (fixture-backed until the agent lane merges); unit tests for
  formatting and state handling; screenshots at desktop and 390 px width of chat, panel, confirm,
  admin and a cap message; no arithmetic on amounts outside the formatter (reviewer greps).

### evals (Codex, after engine and agent merge)

- Owns: `evals/` (cases, recordings, harness, results), `scripts/eval-live.*`, the `eval:live`
  script entry (added by the Architect at Stop 2 so `package.json` stays frozen).
- Must not touch: application code.
- Builds: 12 to 15 cases covering all six user stories, each with expected numbers computed by
  calling the engine on the seed (never typed by hand); a replay mode that runs inside `npm test`
  against committed recordings and checks every expected number appears and every number in the
  answer traces to a tool result; `npm run eval:live` against the deployed URL that re-records,
  stops on the first budget or cap error, and writes the pass rate and run date.
- Done: `npm test` passes offline with no network; a planted wrong number in a recording makes it
  fail; one live run recorded (scheduled per D-8) with its pass rate.

### release (Claude Code, last)

- Owns: `README.md`, `scripts/export-transcripts.*`, `prompt-history/transcripts/`, the final
  `PROMPTS.md` pass, deploy checklist in the README.
- Must not touch: application code; findings go back as issues or small fix PRs by the owning lane.
- Builds: Reviewer pass over the whole repo (secrets, input validation, no LLM math, README accuracy,
  prompt-history completeness, no personal or employer data); README with every section the
  assignment lists; transcript export scrubbed of secrets, tokens and home paths, cross-checked
  against `PROMPTS.md`.
- Done: every assignment acceptance box is checked with evidence or listed as not done.

## Starting each lane (the owner runs these)

Create the worktree, then start the agent inside it. Each lane agent sees only its prompt file, the
assignment and the repo.

    wt cf-billing-copilot engine
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/02-engine.md)"

    wt cf-billing-copilot agent
    claude "$(cat prompt-history/prompts/03-agent.md)"

    wt cf-billing-copilot ui
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/04-ui.md)"

    wt cf-billing-copilot evals          # after engine and agent merge
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/05-evals.md)"

    wt cf-billing-copilot release        # after evals merges
    claude "$(cat prompt-history/prompts/06-release.md)"

## Cross-review

Codex-authored PRs (engine, ui, evals) go through the no-mistakes gate, where Claude reviews. The
lane agent pushes with:

    git push no-mistakes

Claude-authored PRs (Stop 1, Stop 2, agent, release) get a Codex review from a detached worktree.
From Stop 2 on, docs/agent/cross-review.md holds the checklist:

    git -C ~/projects/cf-billing-copilot fetch origin
    git -C ~/projects/cf-billing-copilot worktree add --detach \
        ~/projects/wt/cf-billing-copilot-review-<N> origin/<branch>
    cd ~/projects/wt/cf-billing-copilot-review-<N> && npm ci
    codex -c model_reasoning_effort=high "Review PR #<N> on annah-dev/cf-billing-copilot as cross-review. Read AGENTS.md, then docs/agent/verification.md, then follow docs/agent/cross-review.md exactly. Per-PR focus is in the PR thread."

For this Stop 1 PR, which predates those files (no `npm ci`, docs only):

    git -C ~/projects/cf-billing-copilot fetch origin
    git -C ~/projects/cf-billing-copilot worktree add --detach \
        ~/projects/wt/cf-billing-copilot-review-<N> origin/feat/architect
    cd ~/projects/wt/cf-billing-copilot-review-<N>
    codex -c model_reasoning_effort=high "Review PR #<N> on annah-dev/cf-billing-copilot as cross-review. It is docs only. Read prompt-history/prompts/00-assignment.md and 01-architect.md, then check docs/ARCHITECTURE.md, docs/DECISIONS.md and docs/agent/plan.md against them and against the current Cloudflare docs they cite. Flag factual errors about Cloudflare APIs or limits, gaps against the Stop 1 checklist, and conflicts with the assignment. Comment on the PR with the verdict first, then findings, then VERIFIED and NOT VERIFIED lines. Do not push, fix or merge."

Close review worktrees with `wtd cf-billing-copilot-review-<N>`. The owner merges every PR
(squash); no agent runs `gh pr merge`, `wrangler deploy`, `wrangler secret put` or `wrangler login`.
