# Evals follow-up gate review round 2

Harness: no-mistakes v1.41.2 (Claude)
Run: 01M3TJ4KE1N1TBVAW6THCD3NZT
Outcome: PASS after the cardinal-label fix; no remaining source findings.
Exact generated review prompt unavailable in axi logs; the identifying log below was copied with a tool, stripping ANSI colors only. This log includes round 1 and its fix followed by the second full review.

```text
step: review
run: "01M3TJ4KE1N1TBVAW6THCD3NZT"
lines: 51 total
log[51]{line}:
  reviewing changes...
  ""
  claude started pid=411865
  ""
  Diff review is complete; I'm writing up the one finding now.
  claude exited pid=411865 status=success
  ""
  user-fix round starting after round 1 (1 finding selected)
  ""
  asking agent to fix identified issues...
  ""
  claude started pid=414323
  ""
  "I've added the regression tests; I'm now installing dependencies in the worktree so I can watch them fail before applying the fix.Red observed. Now the fix.Regrade changed only `regradedAt` timestamps — no issue or verdict changes. Now updating docs/logs.Now write the prompt logs, DECISIONS, PROMPTS entries, and doc updates.I've fixed the review-round-1 finding: a spoken quantity such as the 40 in \"forty first-time invoices\" is no longer erased by the grader."
  ""
  "**The fix (`evals/grounding.ts:119`):** when a number word is followed by a space and then an ordinal used as a label (`first-time`, `second-hand`, or the spaced forms `first time` / `second hand`), the number now still counts as a figure that needs evidence. Ordinals joined by a hyphen, such as \"twenty-first\", and \"one hundred and second\" are still ignored. \"One second\" still counts as 1. Ambiguous prose like \"the twenty first time\" is now checked as 20; I chose to keep that quantity rather than drop it, and logged the choice in `docs/DECISIONS.md`."
  ""
  "**Verification:**"
  "- **New tests:** five cases (forty first-time, one hundred first-time, twenty second-hand, and the two spaced forms) failed before the fix (5 failed, 85 passed) and pass after it (90 of 90)."
  "- **Regrade:** I ran the shared regrade on all 39 recordings with `EVAL_REGRADE_ALL=1`. The only change is the `regradedAt` timestamp in the four report files. No issue was added or removed and no pass/fail result changed. Corrected totals stay 9/15, 2/9, 8/15 and raw totals stay 4/15, 1/9, 5/15. Recordings and grading history are unchanged, and no model calls were made."
  "- **Test count:** main collects 353 tests and the branch now collects 372, so 19 added and none missing. The docs list the five new test names."
  "- **Checks run:** typecheck passed, all eval tests passed (149 of 149), formatting passes after reformatting the new test, and `git diff --check` is clean."
  "- **Not run:** the full `npm test` and its credential-free run. Review-phase rules leave those to the test step, so `evals/followup-verification.md` marks the earlier 367-test result as before this fix and lists the final-head run as NOT VERIFIED."
  ""
  "**Logs:**"
  "- **New prompt files:** `prompt-history/prompts/05g-evals-followup-review-r1.md` holds the round-1 step log and the full finding. It notes that the exact review prompt was not exposed by the logs. `prompt-history/prompts/05r-evals-followup-cardinal-fix.md` is a copy of your fix instructions."
  "- **`PROMPTS.md` and `docs/DECISIONS.md`:** the new entries were added at the end. Main's existing bytes are unchanged at the start of both files."
  "- **Results docs:** `evals/followup-verification.md` and `evals/results/README.md` now include this round's failing-then-passing results, the regrade outcome and the new counts."
  ""
  Nothing is committed yet; the changes are in the worktree for the pipeline.
  ""
  "---"
  ### NEEDS YOUR INPUT
  Nothing - proceeding with handing the fix round back to the pipeline.
  ""
  ### RECOMMENDED NEXT STEP
  Let the pipeline continue to source-review round 2 on the full follow-up diff.
  ""
  ### UPCOMING NEXT STEPS
  "- Test step: full and credential-free `npm test` at the final head, expecting 372 tests."
  "- If needed, a third review round limited to the changes since round 2."
  "- Lint and docs steps, then gated push, PR and CI, then stop at checks passed."
  claude exited pid=414323 status=success
  ""
  "committed agent fixes: no-mistakes(review): Keep cardinals before ordinal labels like first-time"
  ""
  reviewing changes...
  ""
  claude started pid=420327
  ""
  claude exited pid=420327 status=success

```
