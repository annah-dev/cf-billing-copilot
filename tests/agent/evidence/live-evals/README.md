# Live eval evidence for the agent fixes

Real Llama 3.3 through Workers AI, served by this branch's local dev at `http://127.0.0.1:5174`,
graded by the evals PR's harness and grader (unchanged). The harness writes into `evals/`; its
outputs were copied here and `evals/` was restored, so this lane changes nothing under `evals/`.
Estimated neurons use the pinned `estimateNeurons` on reported token totals, not meter readings.

| Run (UTC) | Code | Coverage | Result | Model calls | Est. neurons |
|---|---|---|---|---|---|
| Baseline, evals lane, 2026-09-30 20:42:51 | main | 15 cases, full set | 9/15 | 46 | 3,687 |
| 2026-10-01 00:17:49, failing-only | guard and fixes, before the empty-tools fix | the 7 then-failing cases, once each | 6/7 | 19 | 1,585 |
| 2026-10-01 00:20:33, full set | HEAD at the time (all fixes) | 15 planned, 13 completed | 13/13 completed pass (13/15 planned) | 34 | 2,946 |

The full run stopped with `cap_reached` before remember-credit and expired-credit-history: the
product's own per-IP sandbox cap (`SANDBOXES_PER_DAY_PER_IP` = 5; local dev has one IP) had been
used by the two failing-only sandboxes and the full run's first three. No cap was raised and no
further run was made. On the 13 cases both runs completed, the baseline passed 8.

Total live use by this lane: 2 harness invocations, 53 model calls, 146,658 input and 2,971
output tokens, about 4,531 estimated neurons. No other live calls.

Guard outcomes seen live (`dev-guard-log.txt`): september-invoice in the failing-only run stated
"7 lines" for a six-line invoice and was corrected on retry; tax-line in the full run stated an
"8.25%" rate no tool returned and was corrected on retry.

remember-credit in the failing-only run: turn 2 passed; turn 0 ended empty because the answer
step sent `tools: []`, which Workers AI rejects (error 8007). That is fixed in "fix(agent): send no
tools field on the answer step", after this run; the full run could not reach the case, so the
fix is covered offline only.

Both dev logs also show `Error: internal error; reference = ...` lines with no stack (21 in the
first run, 14 in the second). No turn failed with them; their source is not identified.
