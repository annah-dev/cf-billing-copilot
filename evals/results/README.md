# Local-dev eval results

These captures use real Llama 3.3 through Workers AI, served by local dev at
`http://127.0.0.1:5173` after rebasing onto merged PR #4 (`2af8f1d`). They are labeled
`local dev`, not deployed-demo results. The release lane will run the deployed evaluation at
`https://cf-billing-copilot.anna-hester.workers.dev` after deployment; the public README's
pass rate must come from that deployed run.

| Run (UTC, 2026-09-30)       | Coverage                  | Passed     | Model calls | Estimated neurons |
| --------------------------- | ------------------------- | ---------- | ----------- | ----------------- |
| 20:42:51 full set           | 15 cases, 17 turns        | 6/15 (40%) | 46          | 3,687             |
| 20:47:12 failing-only rerun | 9 failing cases, 11 turns | 1/9        | 33          | 2,999             |

Total: 79 model calls, 225,252 input tokens, 3,246 output tokens, estimated 6,686 neurons.
Estimates use the pinned `estimateNeurons` function on each turn's reported token totals;
they are not a Cloudflare meter reading. Per-call rounding can differ from per-turn rounding.
No further model calls were made. Four sandboxes were used, with existing sandbox ids reused
for the failing-only rerun. Caps were unchanged.

The first run's original grading was 4/15 because the count matcher incorrectly read the
month suffix in `2026-09 invoice` as an invoice count. An offline regrade corrected that
false positive to 6/15. `initialGrading` and `regradedAt` preserve the original report and the
correction; raw responses and usage were unchanged.

Current replay snapshot: 7/15 pass. This combines six first-run passes and one passing rerun;
it is not a second full run. Every active fixture is live. The complete first captures and
failing-only rerun captures are archived under `evals/recordings/runs/`.

Eight cases still fail:

- `september-invoice`: says "7 lines" for an engine invoice with six; both attempts caught.
- `request-tiers` and `tax-line`: fabricated invoice ids in explainLineItem calls.
- `august-september-change`: comparison answer omits the spike/date/multiplier. The agent's
  deterministic anomaly trigger covers invoice fetch/explanation, not comparison alone.
- `pro-simulation`, `scale-simulation` and `remember-plan`: unprefixed plan ids rejected by
  the frozen tool schema.
- `remember-credit`: fabricated invoice id in startCreditRequest; the expected new request
  and memory follow-up cannot be established. The separate duplicate-credit case passed
  on its rerun.

`npm test` must expose these failures. Recordings are not rewritten, assertions are not
weakened, and failing questions are not skipped to make the suite green. The owning agent
lane needs to correct the behavior before the replay done-contract can pass.

Every run JSON includes base URL, UTC date, environment label, model call count and estimated
neurons. `latest-run.json` aliases the failing-only run; sum only `run-*.json` for total usage.
