# PR #9 cross-review, round 2 (full)

You are reviewing pull request #9 again after the round-1 fixes in this repository, branch `fix/ui-live-default`, authored by
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

## Round 1 and its dispositions

Round 1 (prompt 06f) requested changes. The author answered:

1. Follow-up reads could overlap a manual Refresh: fixed. Follow-up reads are quiet (they do not
   clear `busy`), so Refresh stays disabled for the whole decision; the Refresh handler also
   ignores clicks while a decision is in progress.
2. Tests did not protect the follow-up loop: fixed. The loop moved into `followUpDecision`
   (src/ui/api.ts) with injected read, sleep and active; six tests cover the retry bound, terminal
   stop, failed read, unmount during a delay and unrelated unfinished requests. Removing the loop
   fails 3 tests; removing the post-delay active check fails 1.
3. Prompt history missing from this PR: fixed. The owner instruction (06e) and the review prompts
   (06f, 06g) are committed here and appended to PROMPTS.md.
4. Unmount did not cancel a delayed read: fixed. `active()` is checked after every delay, and
   `refresh` returns early once the page is unmounted, so no read starts and no generation
   advances after cleanup.
5. Fragment credentials bypass mode separation: rebutted. An approval link minted by the old
   fixture build carries a fixture sandbox id that the live API never admitted, so it gets 404 or
   401 and the page shows the error; nothing is read or written. Noted in the DECISIONS entry.

Re-check every round-1 finding against the new head, then review the whole diff again as a full
round. Say for each round-1 item whether the fix holds.

## PR body

The PR claims: typecheck, lint and tests pass (364 tests, 11 added, none removed); planted
defects turn the new tests red; a production bundle with no env var runs in live mode; after
Approve the admin card reaches applied with no manual refresh, Refresh stays disabled during the
follow-up and list reads never overlap (mocked API, Playwright); origin/main's bundle stays in
fixture mode; not deployed.
