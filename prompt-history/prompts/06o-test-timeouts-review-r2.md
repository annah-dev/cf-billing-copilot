# PR (fix/test-timeouts) cross-review, round 2 (full)

You are reviewing a pull request in this repository, branch `fix/test-timeouts`, authored by
Claude Code (release engineer) at the owner's request (prompt-history/prompts/06m-release-phase2-start.md:
"The credential-free test run times out intermittently under load. Reviewers will run npm test,
so make it reliable (a suite timeout or less parallelism) without weakening any assertion.").
You are read-only: do not edit, commit, push, rebase or merge anything, and make no network or
live model calls.

The diff under review:

    git diff origin/main...origin/fix/test-timeouts

It changes vitest.config.ts, which AGENTS.md hard rule 4 freezes after the foundation PR; a change
there is allowed only as its own PR to main, which this is. Check against AGENTS.md,
docs/agent/cross-review.md ("What the reviewer checks"), docs/agent/verification.md and
docs/DECISIONS.md (the new entry at the end).

Focus on:

1. Does the change weaken any gate? No assertion, skip, include pattern, setup file, pool option
   or network guard may change; only `testTimeout` and `hookTimeout` (30 s) in both projects.
   Confirm the collected tests are identical (`npx vitest list` at main and head).
2. Is it effective? Vitest inline projects do not inherit root `test` options, so the values must
   be set per project; are they applied in both? Would a hanging test now take 30 s to fail, and
   is that acceptable? Do per-test timeouts already in tests (30 s, 60 s) still win?
3. Is the evidence honest? The author could not reproduce a timeout on this machine (12 cores,
   4 parallel runs, 1-core pinning, 2 runs on 1 core all passed) and justifies the change by the
   margin of the slowest default-timeout test (about 3.4 to 3.6 s against 5 s) plus a probe test
   (6 s) that fails at 5000 ms without the change and passes with it. Is the claim scoped
   correctly in VERIFIED / NOT VERIFIED? Would less parallelism be the better fix?
4. Rules: plain ASCII comment, DECISIONS entry appended with "Decided by", prompt log entries.

Round 1 (prompt 06n) requested changes, all on evidence and rationale; the author accepted all
three: (1) the PR body now carries `npm ci` evidence; (2) the UI live-chat test, which sets its
own 60 s timeout, is no longer cited as relying on the 5 s default; (3) the DECISIONS entry no
longer says less parallelism cannot help a slow test; it says contention was not reproduced and
timeout headroom keeps current concurrency. Re-check each round-1 item, then review the whole diff
again as a full round. The current PR body is available with `gh pr view 13` if your sandbox has
network; otherwise say so.

You may run `npm ci`, `npm run typecheck`, `npm test` and `npx vitest list` in a scratch copy if
your sandbox allows it; say which you ran.

Report: a verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each with
severity (blocker, major, minor, nit), file and line, what is wrong and the fix you suggest. End
with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>
