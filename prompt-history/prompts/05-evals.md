# 05 - Evals lane kickoff

Role: QA / evals engineer. Harness: Codex CLI. You start after the engine and agent lanes have
merged. You work alone in this worktree (~/projects/wt/cf-billing-copilot-evals, branch
feat/evals, cut from that main). You see this prompt, the assignment and the repo; nothing else.

## Read first, in this order

1. prompt-history/prompts/00-assignment.md: the user stories and the eval requirement.
2. AGENTS.md: the rules, including Decision rights. They bind you.
3. docs/agent/plan.md, section "evals": what you own, what you build, your definition of done.
4. docs/agent/verification.md: the evidence your PR must carry.
5. src/contracts/http.ts (`TurnRequest`, `TurnResponse`, `ToolCallRecord`), tools.ts and
   engine.ts; src/engine/ (read only); docs/DECISIONS.md D-7, D-8, D-15, D-17.

At session start, append this prompt to PROMPTS.md by copying this file with a tool (not by
retyping), with an ISO-8601 timestamp with offset, role, harness "Codex CLI", source path and
outcome "(pending)". Fill in the outcome at the end.

## Scope

You own `evals/`, including `evals/vitest.live.config.ts` (the existing `npm run eval:live` script
runs it), plus the append-only files. Application code is read only.

Build:

- 12 to 15 cases covering all six user stories (invoice explanation, what changed, plan
  simulation, anomaly, credit request, memory across sessions), each with expected numbers computed
  by calling `engine` on `engine.seed()` inside the harness, never typed by hand;
- replay mode, collected by the `unit` project (`evals/**/*.test.ts`) into `npm test`: runs each
  case against a committed recording of `TurnResponse`s and checks that every expected number
  appears in the answer as its `display` string and that every money-looking string in the answer
  traces to a tool output in the same recording;
- live mode (`npm run eval:live`, never in CI or `npm test`): posts each case to the deployed
  `/api/sandboxes/:sid/customers/:cid/turn` in a fresh sandbox, re-records, stops on the first
  `budget_exhausted`, `cap_reached` or `rate_limited`, and writes the pass rate and run date to a
  committed results file. The deployed URL comes from an environment variable, never hard-coded
  secrets.

## Definition of done

As in docs/agent/plan.md "evals / Done": `npm test` passes offline with no network; a planted
wrong number in a recording makes replay fail (show it red); one live run recorded with its pass
rate and date once the owner has deployed (a few dozen model calls; report the count). If the demo
is not deployed yet, finish everything else, say so, and give the owner the exact command to run.

## Rules that are easy to miss

- When web docs and the installed type definitions disagree, the installed types win; record the
  disagreement in docs/DECISIONS.md.
- Contracts are frozen. If one is wrong, stop, explain, and wait: the fix is its own PR to main.
- Decide implementation details yourself; record each non-obvious one at the end of
  docs/DECISIONS.md headed `## evals: <decision>`, with a one-line reason and "Decided by: QA
  engineer under standing orders". Owner questions go in one batched message with a recommendation
  each; keep working on anything they do not block.
- One live run, never a loop against the live model; a readiness check never calls the turn
  endpoint.
- Plain ASCII in docs and comments. Small conventional commits, no co-author footers.

## Review loop and finishing

1. Rebase on origin/main, run the done-contract commands, commit.
2. Push through the gate: `git push no-mistakes feat/evals`. Claude reviews there
   (docs/agent/no-mistakes.md). Log each gate run in PROMPTS.md with role "automated cross-review",
   harness "no-mistakes v1.41.2 (Claude)", source "no-mistakes built-in review step, run <id>".
3. Read parked findings yourself (`no-mistakes axi status`, `no-mistakes axi logs --step review
   --full`), fix them on your branch (after `no-mistakes axi sync` if offered), push through the
   gate again. Two full rounds, a third on the delta only, then stop. Anything still disputed goes
   to the owner as a FOR ANNA list with both positions.
4. The gate opens the PR. Make sure its body carries the evidence from docs/agent/verification.md,
   ending with VERIFIED and NOT VERIFIED lines. Never merge; the owner merges.
