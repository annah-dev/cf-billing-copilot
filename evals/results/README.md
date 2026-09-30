# Local-dev eval results

These captures use real Llama 3.3 through Workers AI, served by local dev at
`http://127.0.0.1:5173` after rebasing onto merged PR #4 (`2af8f1d`). They are labeled
`local dev`, not deployed-demo results. The release lane will run the deployed evaluation at
`https://cf-billing-copilot.anna-hester.workers.dev` after deployment; the public README's
pass rate must come from that deployed run.

| Run (UTC, 2026-09-30)       | Coverage                  | Passed     | Model calls | Estimated neurons |
| --------------------------- | ------------------------- | ---------- | ----------- | ----------------- |
| 20:42:51 full set           | 15 cases, 17 turns        | 9/15 (60%) | 46          | 3,687             |
| 20:47:12 failing-only rerun | 9 failing cases, 11 turns | 2/9        | 33          | 2,999             |

Total: 79 model calls, 225,252 input tokens, 3,246 output tokens, estimated 6,686 neurons.
Estimates use the pinned `estimateNeurons` function on each turn's reported token totals;
they are not a Cloudflare meter reading. Per-call rounding can differ from per-turn rounding.
No further model calls were made. Four sandboxes were used, with existing sandbox ids reused
for the failing-only rerun. Caps were unchanged.

The first run originally graded 4/15. An offline correction stopped reading the month
suffix in `2026-09 invoice` as an invoice count, bringing it to 6/15. A second correction
allows the agent to recover after a rejected tool call: rejected calls must have null output
and provide no grounding evidence, while successful calls still validate inputs and outputs.
This changes the full-run grade to 9/15 and the rerun to 2/9. `initialGrading`,
`gradingHistory` and `regradedAt` preserve the earlier grades. Raw responses and usage did
not change. Rerun selection used the failing grades available at capture time.

Current replay snapshot: 8/15 pass. This combines the latest recording for every case; it is
not a second full run. The tier and tax cases passed initially but regressed on the rerun.
Every active fixture is live. Both response sets are archived under `evals/recordings/runs/`.

Seven cases still fail:

- `september-invoice`: says "7 lines" for an engine invoice with six; both attempts caught.
- `request-tiers` and `tax-line`: fabricated invoice ids prevent explanation; expected amounts
  are absent in the latest answers.
- `august-september-change`: comparison answer omits the spike/date/multiplier. The agent's
  deterministic anomaly trigger covers invoice fetch/explanation, not comparison alone.
- `pro-simulation`: rejected plan ids prevent the expected simulation answer.
- `scale-simulation`: after rejected plan ids, answers about the current invoice without
  identifying Scale. Some amounts coincide with the expected simulation, but meaning fails.
- `remember-credit`: the first turn recovers and creates a request, but both final answer texts
  are empty. The separate duplicate-credit and plan-memory cases pass in the latest captures.

`npm test` must expose these failures. Recordings are not rewritten, assertions are not
weakened, and failing questions are not skipped to make the suite green. The owning agent
lane needs to correct the behavior before the replay done-contract can pass.

Every run JSON includes base URL, UTC date, environment label, model call count and estimated
neurons. `latest-run.json` aliases the failing-only run; sum only `run-*.json` for total usage.
