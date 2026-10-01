# PR #9 cross-review, round 1 (full)

You are reviewing pull request #9 in this repository, branch `fix/ui-live-default`, authored by
Claude Code (release engineer) at the owner's request. You are read-only: do not edit, commit,
push, rebase or merge anything, and make no network calls or live model calls.

The diff under review:

    git diff origin/main...origin/fix/ui-live-default

The PR body is reproduced at the end of this prompt. Check the change against:

- prompt-history/prompts/00-assignment.md (acceptance criteria)
- prompt-history/prompts/06e-release-owner-phase1-answers.md (the owner's instruction for this PR:
  "live is the default for production builds" and the admin re-fetch after a decision)
- AGENTS.md (hard rules and decision rights)
- docs/agent/cross-review.md ("What the reviewer checks")
- docs/agent/verification.md (done-contract)
- docs/DECISIONS.md entries "ui: Fixture transport and live handoff", "ui: Approval links and
  refresh boundaries" and the two new `ui:` entries at the end

Focus on:

1. Mode selection. Does `apiMode(import.meta.env)` give live for `vite build` and fixture for
   `vite dev` with no variable set, and honour `VITE_BILLING_API_MODE`? Could any path still send a
   fixture session to the live API or the reverse (separate storage keys)? Is the `?preview=`
   scenario still restricted to the dev fixture preview?
2. Admin follow-up. Is the loop bounded, does it stop at a terminal state and on unmount, can it
   overlap a user-triggered refresh or a second decision, and does it respect the 200-request daily
   cap rationale? Does `refresh` returning data change any existing behaviour (stale generation,
   errors)?
3. Tests. Do the five new tests check what the PR claims; can they fail; is anything claimed but
   untested? The PR says browser evidence was produced with a mocked API: is the claim scoped
   honestly in VERIFIED / NOT VERIFIED?
4. Rules: no money arithmetic in the UI, no frozen file changed (src/contracts, wrangler.jsonc,
   package files, vitest config, tsconfig, .github, AGENTS.md), plain ASCII in comments and docs,
   DECISIONS entries appended only, with "Decided by".

You may run `npm ci`, `npm run typecheck`, `npm test`, `npx vitest list` and `npx vite build` in a
scratch copy if your sandbox allows it; say which you ran.

Report: a verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each
with severity (blocker, major, minor, nit), file and line, what is wrong and the fix you suggest.
End with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>

## PR body

See `gh pr view 9` if available; otherwise rely on the diff and the commit message. The PR
claims: typecheck, lint and tests pass (358 tests, 5 added); planted defects in `apiMode` and
`awaitingWorkflow` turned the new tests red; a production bundle with no env var ran in live mode
and the admin card reached "applied" 2.4 s after Approve with no manual refresh against a mocked
API; origin/main's bundle failed the same check; not deployed.
