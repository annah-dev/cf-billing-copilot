# Post-PR-7 grader verification

Branch fix/evals-figures-simulation starts at merged main 8c943bd. Anna authorized syncing
feat/evals to PR #7's confirmed published e893baa with local safety ref
refs/no-mistakes/recover/evals-owner-sync-post-pr7 preserving 9fa01a8. The merged remote
branch had been deleted. No published history rewrite, application or frozen-file change.

Ordinal words are labels rather than figures. Numerals (including 2nd) and spelled-out
cardinals still require evidence. Compound ordinals are ignored, but the cardinal in
"one second" remains checked. Simulation turns require a successful simulatePlan receipt
matching engine-backed requested plan/period in both input/output and customer in output.
This applies to both simulation stories and both plan-memory turns; a current invoice
with coincident amounts cannot supply a receipt.

## Red and green evidence

Before the fix, the new ordinal/receipt regressions produced:

```text
Test Files 1 failed (1)
Tests 6 failed | 76 passed (82)
```

The coincidental Scale regression kept the known-good engine answer and replaced its
simulation with the cus_3 current-invoice tool result. Old checkReplay returned [] instead
of a missing simulation issue, proving amounts/meaning alone could pass. Rejected and
wrong input/output simulations also incorrectly supplied no failure. Ordinal wording was
incorrectly flagged as quantities. After the fix, independent grader tests pass, including
known-good answers for all 15 cases and the six cardinal/numeral negative cases.

Before report regeneration, exact-verdict replay observed:

```text
Test Files 1 failed | 1 passed (2)
Tests 6 failed | 119 passed (125)
```

The six mismatches were active and two archived attempts for each of Pro/Scale. Their pass
booleans stayed false; new issues still caused red. Then the explicit shared offline command
ran on every recording, without changing responses:

```sh
EVAL_REGRADE_ALL=1 npx vitest run --config evals/vitest.fixture.config.ts evals/regrade.fixture.ts
```

```text
All 39 recordings regraded; latest snapshot 8/15. Zero model calls.
```

Only missing-successful-simulation issues were added for pro-simulation and scale-simulation
in each capture and active snapshot. No issue removed and no pass/fail verdict changed.
Corrected full/rerun/latest remain 9/15, 2/9, 8/15; original raw grades remain 4/15, 1/9, 5/15.
Ordinal exclusion changes no recorded grade. All raw recording bytes/digests, initialGrading,
previous gradingHistory, rawGrading and target/date/usage equal main; previous corrected
issues were appended to history by the shared generator. All expectations remain engine-backed.
Model failures stay reported data, with exact verdicts/issues compared in npm test.

## Review round 1: cardinal before an ordinal label

Claude review round 1 (run 01M3TJ4KE1N1TBVAW6THCD3NZT) found that a tens/hundreds cardinal
before an ordinal label was erased as a compound ordinal, so "forty first-time invoices"
hid 40. Five regressions with no numeric evidence were added first and observed red:

```text
Test Files 1 failed (1)
Tests 5 failed | 85 passed (90)
```

The fix keeps a whitespace-separated cardinal when the ordinal is used as a label
(`first-time`, `second-hand`, spaced `first time`/`second hand`); compound ordinals
such as twenty-first and one hundred and second stay excluded, and "one second" still counts 1.
After the fix `npx vitest run evals/grounding.test.ts` reports `Tests 90 passed (90)`. The
explicit EVAL_REGRADE_ALL=1 shared regrade then reprocessed all 39 recordings: the only diff is
`regradedAt` in the four report files. No issue added or removed, no verdict changed; totals
stay corrected 9/15, 2/9, 8/15 and raw 4/15, 1/9, 5/15. Recordings, initialGrading and
gradingHistory are byte-identical. Zero model calls.

Historical planted $999,999.99 and grader-only extra-issue red evidence is retained in
verification.md; their negative unit guards are still executed here. New ordinal and
simulation regressions were independently watched fail before fixing, as shown above.

## Commands

```text
npm ci: exit 0
added 571 packages, and audited 572 packages in 55s
npm run typecheck: exit 0
> tsc --noEmit && tsc --noEmit -p tests/agent
npm test: exit 0
Test Files 22 passed (22)
Tests 367 passed (367)
env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test: exit 0
Test Files 22 passed (22)
Tests 367 passed (367)
```

No skips. Both projects prohibit global fetch and require no Cloudflare credentials.
The npm test tails above predate review round 1 (367 tests); the full-suite and credential-free
reruns at the final head belong to the gate's test step. After round 1, `npx vitest list --json`:
main 8c943bd 353, head 372; zero disappeared, 19 added, comparing project/relative path/full name. The exact added test names are:

```text
unit | evals/grounding.test.ts | eval defect guards > a coincidental current-invoice match cannot pass a Scale simulation
unit | evals/grounding.test.ts | eval defect guards > a rejected simulation cannot supply a simulation receipt
unit | evals/grounding.test.ts | eval defect guards > keeps the cardinal before an ordinal label in We saw forty first time invoices.
unit | evals/grounding.test.ts | eval defect guards > keeps the cardinal before an ordinal label in We saw forty first-time invoices.
unit | evals/grounding.test.ts | eval defect guards > keeps the cardinal before an ordinal label in We saw one hundred first-time customers.
unit | evals/grounding.test.ts | eval defect guards > keeps the cardinal before an ordinal label in We sold twenty second hand items.
unit | evals/grounding.test.ts | eval defect guards > keeps the cardinal before an ordinal label in We sold twenty second-hand items.
unit | evals/grounding.test.ts | eval defect guards > ordinal words are not figures even without tool evidence
unit | evals/grounding.test.ts | eval defect guards > simulation evidence must match the requested customer
unit | evals/grounding.test.ts | eval defect guards > simulation evidence must match the requested output period
unit | evals/grounding.test.ts | eval defect guards > simulation evidence must match the requested output plan
unit | evals/grounding.test.ts | eval defect guards > simulation evidence must match the requested period
unit | evals/grounding.test.ts | eval defect guards > simulation evidence must match the requested plan
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure 1 without tool evidence
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure 2nd without tool evidence
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure one second without tool evidence
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure one without tool evidence
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure twenty-one without tool evidence
unit | evals/grounding.test.ts | eval defect guards > still checks numeral or cardinal figure two without tool evidence

```

Lane formatting and git diff --check pass. Main's existing PROMPTS.md and DECISIONS.md are
byte-identical prefixes. Package pins, configs, contracts and src/agent are unchanged.
Zero new live model calls or neurons. Historical local-dev run remains dated 2026-09-30,
79 calls and estimated 6,686 neurons; no deployed performance is claimed. See results/README.md
for every correction, raw/corrected totals and failure analysis. Owner policy and safety-ref
synchronization are recorded in DECISIONS.md; receipt identity is a lane implementation choice.

VERIFIED: Red-first ordinal/receipt and cardinal-label regressions; all 39-recording shared regrades with immutable raw evidence and no changed verdict; independent grader guards; exact-verdict replay; 367 passing offline and credential-free tests before review round 1; 90 passing grader tests after it; npm ci/typecheck; zero coverage disappeared, 19 added (372 collected); scope/prefix checks; no new model calls.
NOT VERIFIED: Exact Claude review round 1 prompt (not exposed by axi logs); full and credential-free npm test at the final head until the gate test step runs; later review rounds, PR and CI until executed; deployed/public evaluation, Cloudflare meter usage and proposed agent/prompt fixes inherited from the local-dev run. No merge or deployment.

## Final evidence after agent-fixes main merged

The gate opened PR #10, then detected an append-only-log merge conflict after PR #8 merged.
Its CI auto-fix rebased the follow-up to main 5b288f3 and force-with-lease repushed published
4dc3e9e. This gate-required history rewrite was reported to Anna; no manual published rewrite.
Both source-review rounds completed before the rebase; the rebase left lane source unchanged.
Main 5b288f3's PROMPTS.md and DECISIONS.md bytes remain prefixes. App source, frozen files,
recordings and original grades are unchanged relative to this new base.

GitHub CI passed npm ci/typecheck/test on 4dc3e9e. An independent git-archive snapshot of the
same head, with the unchanged pinned installed modules, ran credential-free npm test and
typecheck. Direct execution in the gate worktree first hit its read-only Vite-temp directory;
that failed attempt is not passing evidence. The isolated snapshot completed successfully:

```text
npm run typecheck: exit 0
> tsc --noEmit && tsc --noEmit -p tests/agent
env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test: exit 0
Test Files 25 passed (25)
Tests 449 passed (449)
```

The post-rebase collection compares main 5b288f3 (430 tests) with head 4dc3e9e (449 tests):
19 added, zero disappeared, project/relative path/full name compared. Added names are those
listed above. Historical 367/372-test tails refer to the earlier main; these final numbers
include the merged agent-fixes tests. Zero new model calls; immutable local-dev captures and
raw/corrected rates are unchanged. The second full source review log is now archived in
05g-evals-followup-review-r2.md; exact generated prompt was not exposed. This last evidence
commit changes only docs/logs. The third, delta-only review (run 01M3TKGDQ50TB5190HDMM0VTT3,
4dc3e9e..15520e0) passed with no source findings; its identifying log is archived in
05g-evals-followup-review-r3.md, exact generated prompt not exposed. No fourth source review.

The gate test step in that run first exited 127 because its fresh worktree had no installed
vitest. After `npm ci` from the frozen lockfile (no package, lock or config change),
`npm run typecheck` passed and both `npm test` and credential-free
`env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test` passed 25 files / 449 tests.

VERIFIED: Two full Claude source reviews and corrected cardinal-label finding; third, delta-only review PASS with no source findings; gate-required rebase with preserved main prefixes and unchanged lane source; CI on 4dc3e9e; independent and gate-worktree 449-test normal/credential-free runs and typecheck; 430/449 collection with no disappearance; all earlier red-first/regrade/immutable-evidence proofs; zero model calls.
NOT VERIFIED: Final PR CI on this documentation-only head until executed; exact generated gate prompts (not exposed); deployed/public evaluation, metered neurons and proposed agent/prompt fixes inherited from the local-dev run. No merge or deployment.

## WSL restart recovery and main PR #9 merge

Run 01M3TKGDQ50TB5190HDMM0VTT3 failed with `daemon crashed during execution`
while monitoring CI. GitHub CI for its published ad782c5 had succeeded (run
36805107743). The daemon was already running after WSL restarted; no forced
restart or version update was used. Offered `no-mistakes axi sync` recovered
ad782c5, retained under refs/no-mistakes/recover/evals-wsl-recovery-ad782c5.

As Anna requested, merge commit 54f1086 adds main a5b05f7 (PR #9) to the
published branch without rewriting history. The sole conflict was DECISIONS.md.
Both complete branch suffixes are retained after main's canonical byte prefixes
in DECISIONS.md and PROMPTS.md. Eval source, tests, recordings and results equal
ad782c5; application and frozen-file contents equal current main.

After the merge, all required commands were repeated:

```text
npm ci: exit 0
added 571 packages, and audited 572 packages in 51s
npm run typecheck: exit 0
> tsc --noEmit && tsc --noEmit -p tests/agent
npm test: exit 0
Test Files 25 passed (25)
Tests 462 passed (462)
env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test: exit 0
Test Files 25 passed (25)
Tests 462 passed (462)
```

`npx vitest list --json` at current main a5b05f7 and recovered head collected
443 and 462 tests, respectively: the same 19 added names listed above, zero
disappeared, comparing project/relative path/full name. Normal test/collection
runs emitted a sandbox read-only Wrangler-log warning but exited 0; the empty
HOME run also passed. No credential, login, model or dev server was needed.
All 41 replay checks pass against the unchanged committed results.

Raw/corrected totals and all 39 recording digests are unchanged by recovery;
zero new model calls or neurons. The completed source-review convergence remains
two full rounds and the third delta-only round. Recovery auditing covers merge
preservation and evidence only.

Fresh recovery gate run 01M3V196CVJCWVV5X97QQ2PBJK: the recovery review passed
with no actionable findings (archived in
prompt-history/prompts/05g-evals-wsl-recovery-review.md). Its test step first
failed with `sh: 1: vitest: not found` in the new gate worktree; once frozen
dependencies were installed, without source, grade, recording or results edits,
`npm test` passed:

```text
Test Files  25 passed (25)
     Tests  462 passed (462)
```

VERIFIED: Recovered published gate commits; safety ref; owner-requested additive
merge preserving both logs; unchanged eval/raw evidence; npm ci/typecheck; 462
offline and credential-free tests; main443/head462 with 19 added and none gone;
recovery review PASS and gate-worktree 462-test run.
NOT VERIFIED: Recovered gate push and final PR CI on this head until executed;
exact generated review prompts; deployed performance and metered usage. No merge
or deployment.
