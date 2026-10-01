# Local-dev eval results

Real Llama 3.3 through Workers AI, served by local dev at `http://127.0.0.1:5173` after
rebasing onto merged PR #4 (`2af8f1d`). Run date: 2026-09-30 UTC. These are local-dev results.
Release owns the deployed rerun at `https://cf-billing-copilot.anna-hester.workers.dev`;
the public README pass rate must come from that deployed run.

| Run (UTC)                   | Coverage           | Raw capture-time grade | Corrected grade | Model calls | Estimated neurons |
| --------------------------- | ------------------ | ---------------------- | --------------- | ----------- | ----------------- |
| 20:42:51 full set           | 15 cases, 17 turns | 4/15 (26.7%)           | 9/15 (60%)      | 46          | 3,687             |
| 20:47:12 failing-only rerun | 9 cases, 11 turns  | 1/9 (11.1%)            | 2/9 (22.2%)     | 33          | 2,999             |

Total: 79 model calls, 225,252 input tokens, 3,246 output tokens, estimated 6,686 neurons.
Estimates use pinned `estimateNeurons` on each turn's reported token totals, not Cloudflare
meter readings; per-call rounding can differ. One full run and one explicit failing-only rerun
were made, with no loop, cap increase or further model calls. Rerun selection used the grades
available at capture time. Four sandboxes were used, with existing ids reused on rerun.

The latest-recording snapshot is **8/15 pass**, versus **5/15** under the capture-time graders.
This is a mixture of the latest attempts, not a second full run. Tier and tax answers passed
initially but regressed on rerun; plan memory recovers correctly and passes both attempts under
the corrected grader. Every active fixture is live. Both attempts are archived unchanged.

`run-*.json` holds each run's capture-time `initialGrading`, intermediate `gradingHistory`,
corrected `cases` and `regradedAt`; response text and usage never change during regrading.
`latest-run.json` aliases the failing-only run. `replay.json` holds raw and corrected verdicts
for all 15 active recordings, target/date/usage metadata, and SHA-256 digests for all 39 active
and archived recording files. Its usage totals cover all captured attempts at this target.
Sum only `run-*.json` for total usage; aliases and snapshots are not additional calls.

## Failure analysis

The table analyzes the seven latest failing questions. Evidence comes from the linked raw
recording, not a new model run. Categories describe observed behavior; proposed fixes are not
implemented here. `src/agent` is unchanged. Under the owner's grounding rule (below and in
[../README.md](../README.md)) an echoed "September 2026" is no longer flagged; each remaining
failure has missing expected values, missing meaning or an ungrounded count/number.

| Question                                                              | Category                          | Evidence                                                                                                                                                                                                                                                                                                                              | Proposed fix and owner                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [september-invoice](../recordings/september-invoice.json)             | ungrounded number stated          | Says "has 7 lines", lists only 1 through 6, and successful getInvoice returns six lines. Both captures do this. Verdict includes `ungrounded count 7 lines` and `ungrounded number 7`.                                                                                                                                                | Agent: validate count claims against the returned invoice array before finalizing. Prompt: explicitly copy counts from array lengths. Do not relax the grader.                                                                                                                                                                                                   |
| [request-tiers](../recordings/request-tiers.json)                     | wrong tool input; tool not called | Calls explainLineItem with invented `inv_1234567890` and `line_1234567890`; gets "No invoice". Never calls getInvoice and says it lacks the invoice id. Expected tier displays and quantity are absent. Initial attempt recovered and passed.                                                                                         | Agent: require invoice lookup before line explanation, supplying returned invoice/line ids. Prompt: reinforce copying ids and recovery after tool errors; rule 5 already forbids invented ids.                                                                                                                                                                   |
| [tax-line](../recordings/tax-line.json)                               | wrong tool input; tool not called | Same invented invoice/line ids and no getInvoice. Final answer says it cannot explain tax. Expected taxable-subtotal and tax displays are absent. Initial attempt recovered and passed.                                                                                                                                               | Agent: use the same invoice-lookup prerequisite as tiers, then explain the returned tax line. Prompt: reinforce error recovery instead of ending with a fabricated-id failure.                                                                                                                                                                                   |
| [august-september-change](../recordings/august-september-change.json) | tool not called                   | Successful compareInvoices supplies totals/deltas, but there is no detectAnomalies call and no spike, date or multiplier in the answer. Both attempts omit the September anomaly.                                                                                                                                                     | Agent (`anomalies.ts`): include comparison periods in the deterministic anomaly trigger and inject the result before the final answer. Prompt: require mentioning reported spikes for comparisons too. The existing trigger only covers getInvoice/explainLineItem.                                                                                              |
| [pro-simulation](../recordings/pro-simulation.json)                   | wrong tool input; tool not called | Calls simulatePlan with `plan_Pro`, rejected by the lowercase slug schema. No getAccount lookup; says it lacks Pro's plan id. Expected simulation displays are absent.                                                                                                                                                                | Agent: obtain availablePlans first and pass the exact returned id; guard invalid plan selections before simulation. Prompt: reinforce verbatim ids. No contract or grader change needed.                                                                                                                                                                         |
| [scale-simulation](../recordings/scale-simulation.json)               | wrong tool input; other           | Calls simulatePlan with `plan_Scale` twice, even after successful getAccount returns valid ids. Falls back to getInvoice and answers about the current bill without naming Scale. Verdict is missing Scale meaning and a successful simulation receipt; some expected displays happen to coincide with this zero-difference scenario. | Agent/prompt: select the returned `plan_scale`, recover from the rejected call and answer the requested scenario. Grader: successful simulation evidence for the requested plan/period is now required for every simulation turn, including memory. The current-invoice fallback cannot satisfy it; this shared rule is applied to every recording.              |
| [remember-credit](../recordings/remember-credit.json)                 | other; wrong tool input           | First invents `inv_202609`, then gets the real invoice and successfully creates a credit request. Its final text is empty. Follow-up calls getCreditRequestStatus four times and also ends empty. Both turns lack expected amount/status text despite valid receipts.                                                                 | Agent (`billing-agent.ts`): reserve a final answer step within the budget, stop repeated identical status calls and return an explicit incomplete-answer error if exhausted. Prompt: after a successful receipt/status, answer with amount and approval state. The trace supports step exhaustion as an inference; it does not prove the model's internal cause. |

## Every grading correction

All rules are shared across cases. The current grader was applied to **every recording**:
15 full-run archives, nine rerun archives and 15 active copies. The owner grounding rule
changed issue lists only; no verdict or pass rate changed. No per-answer override, pass
exception, raw response edit or automatic regrade in `npm test` exists. Earlier grades remain
visible rather than being relabeled as model improvements.

| Correction                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                       | Unit evidence and result impact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Natural named/abbreviated calendar dates  | The original numeric matcher rejected correct "September 18" / "September 2026" wording or treated separately grounded date parts as proof of a fabricated full date. Normalize coherent dates, infer a year only from one grounded month/year.                                                                                                                                                                           | `accepts a natural calendar date grounded by the engine` and wrong/fabricated-date tests. Fixed before live capture; no capture-time grade change.                                                                                                                                                                                                                                                                                                                                                                       |
| Calendar day from UTC timestamps          | The `T` separator hid the date in credit creation/deadline timestamps, falsely rejecting correct natural dates.                                                                                                                                                                                                                                                                                                           | `accepts a deadline date taken from a UTC timestamp` and `rejects a fabricated deadline date`. Fixed before live capture.                                                                                                                                                                                                                                                                                                                                                                                                |
| Month/year from complete timestamps       | Grounding a timestamp day did not ground its YYYY-MM prefix, falsely rejecting "October 2026".                                                                                                                                                                                                                                                                                                                            | `grounds month-year wording from a complete timestamp`, with a red regression observed before fixing. Fixed before live capture.                                                                                                                                                                                                                                                                                                                                                                                         |
| Numeric/count coverage                    | Money-only/scalar checks missed written numbers and did not derive counts or ordinal positions from arrays. Add written integer/ordinal normalization, array lengths/positions, contextual invoice-line counts, signed/fractional/compact tokens and singular/plural money words. The follow-up below excludes ordinal words while keeping numeral ordinals. An unrelated scalar seven cannot excuse seven invoice lines. | Known-good engine answers for every case; both `7 lines` and `seven invoice lines` known-bad tests; invented written counts/money and signed/fractional/compact tests. Added before live capture per the owner's every-number instruction; actual seven-line failures remain failures.                                                                                                                                                                                                                                   |
| ISO period next to invoice is not a count | `2026-09 invoice` matched `09 invoices`. Exclude hyphenated date components; a grounded year before singular invoice is date wording.                                                                                                                                                                                                                                                                                     | `does not mistake an ISO month next to invoice for a count` and singular-invoice/ordinal tests. Offline full-run grade 4/15 to 6/15; no response or usage change.                                                                                                                                                                                                                                                                                                                                                        |
| Recovery after rejected tools             | The original parser failed any rejected tool call even when the agent subsequently called a valid tool and answered correctly. Validate successful inputs/outputs; failed calls must have null output and provide no evidence. Confirmed credit turns still require a successful start receipt.                                                                                                                           | `allows recovery after a rejected tool call without trusting its failed output or input`, schema/failed-output guards, and `a confirmed credit answer requires a successful request receipt`. Offline full run 6/15 to 9/15; rerun 1/9 to 2/9. Tiers, tax and plan memory's first answers were previously graded too strictly. Empty credit answers still fail.                                                                                                                                                          |
| Owner grounding rule (per-turn evidence)  | Anna's rule (docs/DECISIONS.md): money, percentages, counts and other numbers need this turn's successful tool outputs; dates and billing periods may also echo the customer's message after format normalization. Tool-only period evidence flagged the question's echoed "September 2026". Evidence now resets every turn; message dates are kept apart from numeric evidence.                                          | Red first: `accepts a billing period echoed from the question without tool evidence` and `prior-turn financial results cannot ground a later answer`; plus echoed natural/ISO/yearless-date passes and echoed `$500.00`, customer percentage/count, question day/year, wrong/fabricated-date rejections. Removed `ungrounded number 2026-09` from pro-simulation (full 1, rerun 1), request-tiers (rerun 2) and tax-line (rerun 2). Other issues remain, so pass rates are unchanged: full 9/15, rerun 2/9, latest 8/15. |

The every-case known-good tests cover all six stories; known-bad tests also cover invented
money, missing expected displays, dates assembled from unrelated parts, wrong counts, rejected
inputs used as evidence, future-turn provenance, malformed successful tool payloads and credit
claims without receipts. The historical raw grades cannot be regenerated by today's corrected
grader; their original reports are retained as evidence.

## Test and release behavior

`npm test` checks the harness. It regrades every committed recording and compares the exact
verdict and issue list with committed results, including negative verdicts. A grader change
fails replay until an explicit all-recordings regrade makes the result diff reviewable. Known-bad
answers must stay bad in the grader unit tests. Model failures are reported data, not failing
tests, and the gate is not allowed to repair a model by changing its recording or verdict.

For a documented grader fix with unit coverage, explicitly regenerate all verdicts offline:

```sh
EVAL_REGRADE_ALL=1 npx vitest run --config evals/vitest.fixture.config.ts evals/regrade.fixture.ts
```

Review the raw/corrected result diff and correction rationale. This command never calls the
model or writes a recording. A future live capture archives responses automatically; release
runs the same explicit report generation after its deployed capture. The test suite must stay
offline and the public README must use the deployed run's result.

## Post-PR-7 grader follow-up

Anna requested two shared corrections after merging PR #7:

- Ordinal words (first, second, twentieth, twenty-first, one hundred and second) are labels,
  not figures. Numerals, including numeral ordinals, and spelled-out cardinal numbers are still
  checked. Regression: `ordinal words are not figures even without tool evidence`; six
  numeral/cardinal negative cases remain rejected. This correction changes no recorded issue.
- Simulation turns require a successful simulatePlan receipt for the requested plan and period,
  with matching input/output and customer identity. Requirements come from the engine-backed
  case scaffold, including both plan-memory turns. Regression: `a coincidental current-invoice
match cannot pass a Scale simulation`, plus rejected-call and wrong-plan/period/customer
  checks. Known-good engine answers for all 15 cases still pass.

Observed red before fixing: six grader regressions failed and 76 passed. After the source fix,
exact-verdict replay rejected six comparisons against old committed issues, while independent
unit answers passed. The explicit shared offline regrade then processed all 39 recording files.
The only issue diff is an added `missing successful simulation` for pro-simulation and
scale-simulation in both captures and the active snapshot. No issue was removed. Both cases
already failed; **no pass/fail verdict changed**. Corrected totals stay full 9/15, rerun 2/9,
latest 8/15. Original capture-time totals remain 4/15, 1/9, 5/15. Previous corrected issues are
preserved in gradingHistory. Ordinal-word exclusion changes no committed recording's grade.
All response bytes, raw grades, target/date and usage are unchanged. This follow-up made zero
model calls and did not modify src/agent. Capture totals remain 79 calls and estimated 6,686
neurons; results still describe local dev, not deployment.
