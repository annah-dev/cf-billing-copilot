# Agent rules

Canonical rules for every agent working in this repo, whatever the harness. CLAUDE.md is a shim
that points here.

- Product scope and acceptance criteria: prompt-history/prompts/00-assignment.md.
- Lanes, ownership, merge order and review loop: docs/agent/plan.md.
- Done-contract (commands and evidence every PR carries): docs/agent/verification.md.
- Review checklist: docs/agent/cross-review.md. Gated push: docs/agent/no-mistakes.md.
- Design: docs/ARCHITECTURE.md. Decisions: docs/DECISIONS.md.

## Commands

    npm ci               install exactly what package-lock.json pins
    npm run typecheck    tsc over src/ and tests/agent/
    npm test             vitest: unit project (Node) and workers project (workerd); offline
    npm run dev          local dev server; every chat message spends real Workers AI neurons
    npm run eval:live    live evals against the deployed URL; spends neurons; never in CI

## Hard rules

1. The model never does money math. Amounts are integer cents computed by src/engine/ and travel
   as `Money` (cents plus a display string from `formatUsd`). No float, no division, no rounding
   of money outside the engine and `formatUsd`. The UI formats; it never computes.
2. Every tool input and output is validated with its zod schema from src/contracts/.
3. Every credit state change and every refused change writes an append-only audit record in the
   same transaction.
4. src/contracts/, wrangler.jsonc, package.json, package-lock.json, vitest.config.ts,
   tsconfig.json, .github/ and this file are frozen after the Stop 2 foundation PR. A lane that
   finds one wrong stops and says so; the fix is its own PR to main.
5. No live model calls in tests, and no loops against the live model. A manual model call is
   deliberate, counted and reported. A readiness probe or health check never hits a path that
   calls the model.
6. No secrets in the repo. No real customer, employer or personal data: synthetic data only.
7. Plain ASCII in docs and code comments (verbatim prompt text in PROMPTS.md and prompt-history/
   is exempt). Small commits with conventional messages and no agent co-author footers.
8. Never hand-edit lock files or generated files (package-lock.json, env.d.ts: run
   `npx wrangler types env.d.ts` instead).
9. Log every prompt: at session start append your own kickoff prompt to PROMPTS.md by copying its
   file with a tool, and log every review prompt you write. Fill in the outcome at the end.

## Sources of truth for APIs

When web docs and the installed type definitions (node_modules) disagree, the installed types win.
Record the disagreement in docs/DECISIONS.md.

## Decision rights

Standing orders from the owner (Anna), 2026-09-29.

1. Cross-review runs without the owner. Every PR gets a review from the harness that did not
   write it.
   - Claude-authored PRs: the author runs Codex headless in its default read-only sandbox against
     the local branch diff (`git diff origin/main...HEAD`):

         codex exec -c model_reasoning_effort=high -o <review-output-file> "$(cat <review-prompt-file>)"

   - Codex-authored PRs: gated push with `git push no-mistakes` (Claude reviews). The lane agent
     reads parked review findings itself (`no-mistakes axi status`,
     `no-mistakes axi logs --step review --full`), fixes them on its branch and pushes again.
   - Convergence: two full review rounds, then a third on the delta only, then stop. Anything still
     disputed goes to the owner as a FOR ANNA list stating both positions.
   - Every review prompt is a file under prompt-history/prompts/ and is logged in PROMPTS.md with
     role "automated cross-review".
2. Agents decide, with a one-line reason in docs/DECISIONS.md: implementation choices inside the
   approved architecture, test design, layout inside a lane's own directories, fixes for review
   findings, and taking the recommended option on any reversible, in-repo question not listed in 3.
3. The owner decides, batched into one message with a recommendation for each: money or account
   changes, scope changes against the assignment, contract changes after the freeze, the security
   and auth model, anything irreversible (deletes, force-push, history rewrite), README claims about
   the owner or about results, and merges. While waiting, keep working on anything the question
   does not block.
4. Every entry in docs/DECISIONS.md ends with "Decided by: Anna" or
   "Decided by: <role> under standing orders".
5. No agent runs `gh pr merge`, `wrangler deploy`, `wrangler secret put`, `wrangler login` or
   `npm run deploy`. When one is needed, give the owner the exact command and stop.
