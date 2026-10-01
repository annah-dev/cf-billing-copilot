# Live eval evidence for the agent fixes

Real Llama 3.3 through Workers AI, served by this branch's local dev at `http://127.0.0.1:5174`,
graded by the evals PR's harness and grader (unchanged). The harness writes into `evals/`; its
outputs were copied here and `evals/` was restored, so this lane changes nothing under `evals/`.
Estimated neurons use the pinned `estimateNeurons` on reported token totals, not meter readings.

| Run (UTC)                                 | Code                                        | Coverage                            | Result                               | Model calls | Est. neurons |
| ----------------------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------------------ | ----------- | ------------ |
| Baseline, evals lane, 2026-09-30 20:42:51 | main                                        | 15 cases, full set                  | 9/15                                 | 46          | 3,687        |
| 2026-10-01 00:17:49, failing-only         | guard and fixes, before the empty-tools fix | the 7 then-failing cases, once each | 6/7                                  | 19          | 1,585        |
| 2026-10-01 00:20:33, full set             | HEAD at the time (all fixes)                | 15 planned, 13 completed            | 13/13 completed pass (13/15 planned) | 34          | 2,946        |

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

## Completion run after the rebase onto main (2026-10-01, owner-authorized)

The owner authorized one run of the two unreached questions. At 01:35:30 UTC the harness stopped
at `cap_reached` before any model call (0 calls, 0 neurons): the per-IP sandbox counter is per
UTC day, and the earlier runs were at 00:17 and 00:20 UTC on the same day, so it had not reset.
expired-credit-history reuses the full run's read-only sandbox, so it was run alone at 01:35:44
UTC: it passed (1/1, 2 model calls, 6,922 input and 43 output tokens, about 194 estimated
neurons). remember-credit needs a new sandbox and was not run; it is waiting for the 00:00 UTC
reset on 2026-10-02. The harness needed the not-reached case listed as not passed in its prior
report; the scratch input marked it so, with the reason, and nothing under `evals/` changed.

Totals for this lane: 55 live model calls, about 4,725 estimated neurons. With the full run, 14 of
15 questions pass and remember-credit has not run on the final code.

## remember-credit under the new per-IP cap (2026-10-01, owner-authorized, PR "fix/prod-chat")

After #11 raised the per-IP sandbox cap to 20, remember-credit ran once at 06:15:27 UTC against
this branch's local dev: it passed (1/1, 6 model calls, 16,257 input and 178 output tokens, about
471 estimated neurons). In turn 1 the model fetched the invoice before starting the request (the
new prompt rule), and the turn answered with the amount and `pending_approval`; turn 2 answered
from the status tool. The harness's prior report was the stopped completion run above, where
remember-credit had not passed.

With this run, all 15 questions have passed live on the agent-fixes code: 13 in the full run,
expired-credit-history and remember-credit in the completion runs.
