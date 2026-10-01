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
`npx vitest list --json`: main 8c943bd 353, head 367; zero disappeared, 14 added,
comparing project/relative path/full name. The exact added test names are:

```text
unit | evals/grounding.test.ts | eval defect guards > a coincidental current-invoice match cannot pass a Scale simulation
unit | evals/grounding.test.ts | eval defect guards > a rejected simulation cannot supply a simulation receipt
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

VERIFIED: Red-first ordinal/receipt regressions; all 39-recording shared regrade with immutable raw evidence and no changed verdict; independent grader guards; exact-verdict replay; 367 passing offline and credential-free tests; npm ci/typecheck; zero coverage disappeared, 14 added; scope/prefix checks; no new model calls.
NOT VERIFIED: Claude gate source review, PR and CI until executed; deployed/public evaluation, Cloudflare meter usage and proposed agent/prompt fixes inherited from the local-dev run. No merge or deployment.
