# 02 - Engine lane kickoff

Role: Billing-engine engineer. Harness: Codex CLI. You work alone in this worktree
(~/projects/wt/cf-billing-copilot-engine, branch feat/engine, cut from main after the Stop 2
foundation merged). You see this prompt, the assignment and the repo; nothing else.

## Read first, in this order

1. prompt-history/prompts/00-assignment.md: product scope and the non-negotiable principles.
2. AGENTS.md: the rules, including Decision rights. They bind you.
3. docs/agent/plan.md, section "engine": what you own, what you build, your definition of done.
4. docs/agent/verification.md: the evidence your PR must carry.
5. src/contracts/ (especially engine.ts, billing.ts, credit.ts, analysis.ts, money.ts): the frozen
   interface you implement. docs/ARCHITECTURE.md and docs/DECISIONS.md for the why.

At session start, append this prompt to PROMPTS.md by copying this file with a tool (not by
retyping), with an ISO-8601 timestamp with offset, role, harness "Codex CLI", source path and
outcome "(pending)". Fill in the outcome at the end.

## Scope

You own `src/engine/` and `tests/engine/`. Nothing else, except the append-only files in
docs/agent/plan.md ("Append-only exceptions"). `src/engine/` imports only `zod` and
`../contracts`: no `cloudflare:*`, `agents`, `@cloudflare/*`, `ai` or `workers-ai-provider`.

Replace the stub in `src/engine/index.ts`. It must keep exporting `engine: BillingEngine`.

Build, all in integer cents with `Money` / `Percent` / `Multiple` from src/contracts/money.ts
(display strings only through `formatUsd` and your own documented percent and multiple formatting):

- rating with graduated tiers (`Tier.priceCents` per `Tier.perUnits` units), one documented
  rounding rule for fractional cents applied once per line, proration for a mid-period plan
  change, tax in basis points, and `buildInvoice`;
- `explainLineItem`, `compareInvoices` (per meter and product, with an engine-written summary),
  `simulatePlan`, `detectAnomalies` (document the baseline method), `validateCreditClaim`
  (respecting existing pending and applied memos so pending plus applied never exceed the disputed
  amount), `balance`;
- `seed()`: the deterministic synthetic dataset. 3 fictional customers (no real company names),
  July to September 2026 daily usage on 4 meters, 3 tiered plans, one invoice per customer per
  month, one duplicate charge in September (two ledger charges sharing a reference), one 5x
  one-day spike on one meter in September, one historical expired credit request with its memo
  and audit records, and one mid-period plan change so proration is exercised. Seed target for the
  demo script: customer 1's September invoice totals 41287 cents and its total change against
  August displays as 38%.

## Definition of done

As in docs/agent/plan.md "engine / Done". In particular: every output parses with its contract
schema; a test fails on any non-integer amount; tier boundaries (at, one below, one above);
proration on the first and last day; the rounding rule; tax; zero usage; duplicate and spike
detection; seed determinism (two runs, identical hash); the seed's record count, kept under 2,500
by a test; a test that fails if `src/engine/` imports anything forbidden. `npm run typecheck` and
`npm test` pass.

## Rules that are easy to miss

- When web docs and the installed type definitions disagree, the installed types win; record the
  disagreement in docs/DECISIONS.md.
- Contracts are frozen. If one is wrong, stop, explain, and wait: the fix is its own PR to main.
- You decide implementation details yourself and record each non-obvious one as a new entry at the
  end of docs/DECISIONS.md headed `## engine: <decision>`, with a one-line reason and
  "Decided by: Engine engineer under standing orders". Owner questions (AGENTS.md, Decision rights
  item 3) go in one batched message with a recommendation each; keep working on anything they do
  not block.
- No live model calls: this lane needs none.
- Plain ASCII in docs and comments. Small conventional commits, no co-author footers.

## Review loop and finishing

1. Rebase on origin/main, run the done-contract commands, commit.
2. Push through the gate: `git push no-mistakes feat/engine`. Claude reviews there
   (docs/agent/no-mistakes.md). Capture each gate review prompt: `no-mistakes axi logs --step review
   --full` shows what the gate sent to Claude. Save that prompt text verbatim with a tool to
   `prompt-history/prompts/02g-engine-gate-review-r<round>.md` and append it to PROMPTS.md with
   role "automated cross-review", harness "no-mistakes v1.41.2 (Claude)" and the run id. If the log
   does not contain the prompt text, save the log lines that identify the run, step and version,
   say in that file and in PROMPTS.md that the prompt text was not available, and list it under NOT
   VERIFIED in the PR.
3. Read parked findings yourself (`no-mistakes axi status`, `no-mistakes axi logs --step review
   --full`), fix them on your branch (after `no-mistakes axi sync` if offered), push through the
   gate again. Two full rounds, a third on the delta only, then stop. Anything still disputed goes
   to the owner as a FOR ANNA list with both positions.
4. The gate opens the PR. Make sure its body carries the evidence from docs/agent/verification.md,
   ending with VERIFIED and NOT VERIFIED lines. Never merge; the owner merges.
