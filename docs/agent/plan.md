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
`docs/ARCHITECTURE.md`. A lane that needs one of these changed (a contract is wrong, a dependency
is missing, a binding is missing) stops, says so, and the fix goes to main as its own PR that every
open lane rebases onto.

Append-only exceptions, open to every lane whatever it owns:

- `docs/DECISIONS.md`: a lane appends new entries at the end, under a heading naming the lane
  (`## <lane>: <decision>`), and never edits an existing entry. Changing an existing decision is a
  main PR.
- `PROMPTS.md`: a lane appends its own kickoff prompt, each review prompt it writes, and their
  outcomes.
- `prompt-history/prompts/`: a lane adds new files named `NN<letter>-<lane>-<purpose>.md` (for
  example `02b-engine-review-r1.md`) and never edits another file.

On rebase, conflicts in these files are resolved by keeping both sides' additions, `PROMPTS.md`
entries in timestamp order, and renumbering only the new entries.

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
  detection, and seed determinism; a test reports the seed's row count and keeps it under 2,500
  (it sizes the global sandbox cap, D-7); a test asserts no forbidden import under `src/engine/`;
  `npm test` passes; the PR carries the evidence docs/agent/verification.md requires.

### agent (Claude Code)

- Owns: `src/server.ts`, `src/agent/`, `src/ledger/`, `src/workflows/`, `src/http/`, `src/quota/`,
  `tests/agent/`.
- Must not touch: `src/engine/` (reads only), UI files, `evals/`.
- Builds: `BillingAgent` (`AIChatAgent`) with the 8 typed tools on Llama 3.3, history trimming and
  memory; `Ledger` DO with the schema, seeding from the engine, state machine, idempotency, audit
  log, single-alarm `timers` queue (recovery, deadlines, 7-day idle deletion), non-model request
  cap; `CreditRequestWorkflow` (`AgentWorkflow`) with
  validate, pending memo, `step.waitForEvent` with an explicit timeout, apply, reject, expire;
  `Quota` DO (per-IP and global sandbox caps, neuron budget); every HTTP endpoint in
  docs/ARCHITECTURE.md with the approver token check and caps.
- Done: workers-pool tests with a stubbed AI binding prove: bad tool input is rejected by zod; the
  flow request, pending, approve, applied, with audit records in order; reject; timeout to expired
  with its audit record; a late approval refused with 409 and audited; a retried idempotency key
  returns the same request and never a second credit; a new sandbox is seeded fresh and shares no
  state with the old one; idle storage deletion fires; missing or wrong token gets 401; per-IP and
  global sandbox caps hold; message and neuron caps return the fixed message without a model call;
  concurrent credit requests with different idempotency keys for the same charge produce at most
  one reservation; a Workflow step replayed after its transaction committed succeeds without a
  second audit record; failure injection (including after instance creation but before the pending
  memo) leaves no request stranded in `requested` or `approved` after the sweep, and an errored
  instance is restarted; competing decisions leave exactly one recorded decision and money follows
  it; a lost approval event is recovered from the recorded decision; a decision recorded just before
  the timeout is honoured; the single alarm fires for the earliest of several timers and is
  rescheduled; the non-model request cap answers 429 without writing and repeated refusals add no
  audit records; fabricated sandbox and
  customer ids get 404 and write nothing; concurrent turns near the neuron stop never exceed it;
  real rows written (`rowsWritten`) for seeding and for deletion each stay under 2,500. Evidence also includes one local-dev chat turn against real Llama
  3.3 (a few calls, not a loop) and the credit flow driven by curl in local dev.

### ui (Codex)

- Owns: `src/app.tsx`, `src/client.tsx`, `src/ui/`, `src/admin/`, `src/styles.css`, `index.html`,
  any admin HTML entry, `public/`, `tests/ui/`.
- Must not touch: server code, contracts, engine, evals.
- Builds: chat page (Agents SDK `useAgentChat`), side panel with the current invoice, credit
  requests and audit trail, confirmation UI for `startCreditRequest` (`needsApproval`), the
  sandbox bootstrap and "Reset demo" (creates a new sandbox and switches to it), the `/admin` page (list, approve, reject with reason), and
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
  fail; one live run recorded with its pass rate and run date (a few dozen model calls, well inside
  the D-7 neuron stop).

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

Create the worktree, change into it, then start the agent. `wt` leaves the calling shell in the
main checkout and opens a herdr workspace; the `cd` makes each block work from either terminal.
Each lane agent sees only its prompt file, the assignment and the repo.

    wt cf-billing-copilot engine
    cd ~/projects/wt/cf-billing-copilot-engine
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/02-engine.md)"

    wt cf-billing-copilot agent
    cd ~/projects/wt/cf-billing-copilot-agent
    claude "$(cat prompt-history/prompts/03-agent.md)"

    wt cf-billing-copilot ui
    cd ~/projects/wt/cf-billing-copilot-ui
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/04-ui.md)"

    wt cf-billing-copilot evals          # after engine and agent merge
    cd ~/projects/wt/cf-billing-copilot-evals
    codex -c model_reasoning_effort=high "$(cat prompt-history/prompts/05-evals.md)"

    wt cf-billing-copilot release        # after evals merges
    cd ~/projects/wt/cf-billing-copilot-release
    claude "$(cat prompt-history/prompts/06-release.md)"

## Rules every lane prompt carries

Each kickoff prompt under prompt-history/prompts/ repeats these, because a lane agent sees only its
prompt, the assignment and the repo:

- When web docs and the installed type definitions disagree, the installed types win; record the
  disagreement in docs/DECISIONS.md.
- Decision rights and the review loop from AGENTS.md: decide inside the lane with a one-line reason
  and "Decided by: <role> under standing orders" in docs/DECISIONS.md; batch owner questions into one
  message with a recommendation each and keep working on anything they do not block.
- The review loop below, run by the lane itself, until it converges or produces a FOR ANNA list.
- Append its own prompt to PROMPTS.md by copying the file, and each review prompt it writes.

## Cross-review (runs without the owner)

Every PR gets a review from the harness that did not write it. Convergence: two full rounds, then a
third on the delta only, then stop. Anything still disputed goes to the owner as a FOR ANNA list
with both positions. Every review prompt is a file under prompt-history/prompts/, logged in
PROMPTS.md with role "automated cross-review".

Claude-authored PRs (Stop 1, Stop 2, agent, release): the author writes the review prompt to a file,
then runs Codex headless in its default read-only sandbox from its own worktree, against the branch
diff:

    git fetch origin
    codex exec -c model_reasoning_effort=high \
        -o <scratch>/review-<pr>-r<round>.md "$(cat prompt-history/prompts/<review-prompt>.md)"

The review prompt names the diff to review (`git diff origin/main...HEAD` for full rounds, the
commits since the previous round for the delta round), the documents to check it against, and asks
for findings with file and line, most severe first, ending with VERIFIED and NOT VERIFIED lines.
The author fixes or rebuts each finding, records the fixes as decisions where they change a
decision, posts a round summary on the PR, and re-runs.

Codex-authored PRs (engine, ui, evals): the lane pushes through the gate, where Claude reviews:

    git push no-mistakes

Review findings park (`auto_fix.review: 0`). The lane agent reads them itself with
`no-mistakes axi status` and `no-mistakes axi logs --step review --full`, fixes them on its branch
(after `no-mistakes axi sync` when the run offers it) and pushes through the gate again. The same
convergence rule applies.

The owner merges every PR (squash); no agent runs `gh pr merge`, `wrangler deploy`,
`wrangler secret put` or `wrangler login`.
