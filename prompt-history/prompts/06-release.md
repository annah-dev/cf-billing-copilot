# 06 - Release lane kickoff

Role: Reviewer and release engineer. Harness: Claude Code. You start last, after the evals lane
has merged. You work alone in this worktree (~/projects/wt/cf-billing-copilot-release, branch
feat/release, cut from that main). You see this prompt, the assignment and the repo; nothing else.

## Read first, in this order

1. prompt-history/prompts/00-assignment.md: the deliverables and acceptance criteria you check.
2. AGENTS.md: the rules, including Decision rights. They bind you.
3. docs/agent/plan.md, section "release"; docs/agent/verification.md; docs/agent/cross-review.md.
4. README.md, PROMPTS.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, evals results.

At session start, append this prompt to PROMPTS.md by copying this file with a tool (not by
retyping), with an ISO-8601 timestamp with offset, role, harness "Claude Code", source path and
outcome "(pending)". Fill in the outcome at the end.

## Scope

You own `README.md`, `scripts/export-transcripts.*`, `prompt-history/transcripts/` and the final
PROMPTS.md pass, plus the append-only files. Application code is read only: a defect you find goes
back to its owning lane as a small fix PR from that lane, or to the owner if no lane is open.

Do, in order:

1. **Reviewer pass over the whole repo**: no secrets or tokens anywhere (code, fixtures, recordings,
   history); every tool input validated; no money math outside `src/engine/` and `formatUsd`;
   approver-token and admission checks on every route; README claims match the code; no real
   customer, employer or personal data; the only personal information is the owner's name as author.
2. **README** with every section the assignment lists: pitch; how each of the four required
   Cloudflare components is used; the architecture diagram; "the LLM never does money math"; the
   demo script (5 clicks or questions covering every user story); local setup; deploy commands for
   the owner; eval results with the live run's pass rate and date; known limitations and what a
   production billing platform needs next; an honest note that it was built with AI-assisted
   coding under the owner's direction; the Llama 3.3 streaming finding (docs/DECISIONS.md DEV-16
   and D-14): with native streaming the tool arguments arrived garbled (quote the evidence
   recorded in DEV-16), on both the pinned and the newest provider versions, and the fix is the AI
   SDK's simulated streaming. Keep the existing "Cost and abuse controls" section (D-13) and the
   scope line about duplicated debits versus refunds.
   Put the demo URL at the top once the owner gives it to you.
3. **Release checklist** in the README: deploy steps the owner runs, the smoke test of the credit
   flow end to end, and the off switch: disable the workers.dev route in the Cloudflare dashboard,
   which takes the demo offline without deleting data.
4. **Transcript export**: a script that exports the raw Claude Code and Codex session transcripts
   for this repo and its worktrees into prompt-history/transcripts/, scrubbed of secrets, tokens,
   email addresses and home-directory paths, and cross-checks PROMPTS.md against them (every prompt
   in a transcript is in PROMPTS.md and the other way round). Report any mismatch rather than
   editing history.
5. **PROMPTS.md**: complete, in order, every outcome filled in.

README claims about the owner or about results are the owner's decision (AGENTS.md, Decision
rights item 3): draft them, then put them in one batched question with a recommendation each.

## Definition of done

Every assignment acceptance box is checked with its evidence, or listed as not done with the
reason. `npm run typecheck` and `npm test` pass.

## Rules that are easy to miss

- When web docs and the installed type definitions disagree, the installed types win.
- No `wrangler deploy`, `wrangler secret put`, `wrangler login` or `gh pr merge`: give the owner the
  exact command and stop.
- Decisions go at the end of docs/DECISIONS.md headed `## release: <decision>` with "Decided by:
  Release engineer under standing orders".
- Plain ASCII in docs and comments. Small conventional commits, no co-author footers.

## Review loop and finishing

1. Rebase on origin/main, run the done-contract commands, push `feat/release` to origin and open
   the PR with the evidence from docs/agent/verification.md, ending with VERIFIED and NOT VERIFIED
   lines.
2. Codex reviews it headless (docs/agent/cross-review.md): write the review prompt to
   `prompt-history/prompts/06b-release-review-r1.md` (then `06c-...-r2`, `06d-...-r3`), log it in
   PROMPTS.md with role "automated cross-review", and run
   `codex exec -c model_reasoning_effort=high -o <scratch>/review-r1.md "$(cat <prompt-file>)"`.
3. Fix or rebut each finding, push, post the round summary on the PR. Two full rounds, a third on
   the delta only, then stop. Anything still disputed goes to the owner as a FOR ANNA list with
   both positions.
4. Never merge; the owner merges.
