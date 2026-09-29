# Agent rules

Canonical rules for every agent working in this repo, whatever the harness. The full rule set, the
done-contract (docs/agent/verification.md) and the CLAUDE.md shim arrive with the Stop 2 foundation
PR; the sections below are already in force.

Product scope and acceptance criteria: prompt-history/prompts/00-assignment.md. Lanes, ownership and
merge order: docs/agent/plan.md. Design: docs/ARCHITECTURE.md. Decisions: docs/DECISIONS.md.

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
