# Evals verification evidence

Offline preparation only, under Anna's early-start note. PR #4 has not been confirmed merged.
The lane contains 15 engine-backed cases across all six stories and 17 planned chat turns.
All recordings are labeled synthetic engine fixtures; they are not model accuracy evidence.
Application code and frozen configuration/contracts are unchanged.

Validation on 2026-09-29 Pacific, main baseline `49a7edd` (D-20, PR #6):

- `npm ci`: exit 0; added 571 packages, audited 572 packages; frozen lock unchanged.
- `npm run typecheck`: exit 0; `tsc --noEmit && tsc --noEmit -p tests/agent`.
- `npm test`: exit 0; Test Files 12 passed (12), Tests 160 passed (160).
- `env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test`: exit 0; Test Files 12 passed (12), Tests 160 passed (160). Global fetch blocked in both projects; no Cloudflare credentials.
- `npx oxfmt --check evals` and `git diff --check`: exit 0.
- Explicit fixture generator: 1 test passed; every expected numeric answer computed from the engine seed. Regeneration also passed; it refuses to overwrite live fixtures.
- `npx vitest list --config evals/vitest.live.config.ts`: only `one deliberate deployed eval run` collected. The root test collection excludes this and fixture generation.
- `env -u EVAL_LIVE_READY -u EVAL_BASE_URL npm run eval:live`: deliberately exited 1 before any fetch with `Set EVAL_LIVE_READY=1 only after Anna confirms PR #4 merged, main is pulled, and the demo is deployed`. This exercised the guard, not a live run.

Replay evidence: all 15 cases passed inside `npm test`:

`september-invoice`, `august-invoice`, `request-tiers`, `tax-line`, `midmonth-plan`,
`zero-tax-invoice`, `august-september-change`, `july-august-change`, `pro-simulation`,
`scale-simulation`, `september-anomaly`, `duplicate-credit`, `remember-plan`,
`remember-credit`, `expired-credit-history`.

Planted-defect evidence: an automated mutation appended `Planted wrong amount: $999,999.99.`
to the generated September recording's answer. The exact committed-replay test exited 1:

```text
FAIL evals/replay.test.ts > billing eval replay > september-invoice [invoice]
Expected: []
Received: ["Turn 0: ungrounded money $999,999.99"]
Test Files 1 failed (1)
Tests 1 failed | 14 passed (15)
```

The mutation restored the original bytes in a finally block. The full normal and
credential-free suites subsequently passed with the original recording. No assertions weakened.

Harness regression tests (31 additional assertions/cases):

- `covers all six stories with 12 to 15 cases and confirms only credit starts` proves scope and D-20.
- `rejects a planted wrong amount even when all expected values still appear`, `rejects a missing expected amount despite otherwise grounded prose`, six `rejects noncanonical or unsupported money` variants, and `rejects invented non-money numbers` prove numeric guards.
- `validates tool inputs and outputs beyond the HTTP envelope` and `rejects failed tools and missing or mismatched turns` prove nested schema, identity and completeness checks.
- `requires proactive anomaly meaning and engine date/multiplier` proves the September story check without mandating a model-selected tool.
- `accepts amounts quoted from engine-written tool narratives` covers summary/rate grounding.
- `cannot ground an earlier answer using a future response` proves temporal provenance.
- Six `stops immediately on ...` cases cover budget, cap and rate limits at both sandbox creation and turn submission, with no retry or next-case request.
- `uses one sandbox for memory turns, new requests without history, and accounts for model usage` proves fresh requests, confirm flags, usage counts and token discard.
- `creates a fresh sandbox for each case and reports failed numeric answers` proves case isolation and honest failures.
- `preserves completed counts and usage when a later sandbox hits the cap` proves partial-run results and the full planned denominator.
- `preserves a partial memory recording when its follow-up hits the cap` retains the first response and reported usage when the second cannot complete.
- `fails closed on a transport or malformed HTTP response without retries` and five `rejects unsafe or missing deployed origin` cases prove transport/schema failure and URL validation.

Coverage comparison: `npx vitest list --json` collected 114 tests at `origin/main` (`49a7edd`)
and 160 at this head. Comparison by project, relative test file and full test name found
zero disappeared tests, 46 added, zero skips. Baseline collection ran from an archived main
snapshot with the identical installed dependencies; no checkout or main files changed.

Gate review round 1 fix (F1 natural dates, F2 source count), 2026-09-29 Pacific:

- Reproduced first: a `september-anomaly` answer worded "Usage spike in September 2026 on
  September 18. $11.60; 15000; 3000; 5x." returned `["Turn 0: missing expected 2026-09-18",
  "Turn 0: ungrounded number 2026", "Turn 0: ungrounded number 18"]` before the fix.
- `npx vitest run --project unit evals/`: exit 0; Test Files 3 passed (3), Tests 55 passed (55).
  The typecheck of the changed eval files and `npx oxfmt` on them also passed.
- `npx vitest list --json`: 169 tests collected (160 before this fix, 9 added, none removed).
  The full `npm test` for this head is run by the gate's test step, not recorded here.
- Added: four `accepts a natural calendar date grounded by the engine` variants, `rejects a wrong
  natural date and still requires the engine date`, `rejects a fabricated full date built from
  separately grounded parts`, `rejects a named day whose month has no grounded period`, `still
  rejects invented numbers and money beside natural date wording`, and `reports recording
  sources: 0 live, 15 synthetic-engine of 15 cases`. No existing assertion was removed or weakened.

Decisions appended: synthetic early-start provenance; memory requests/credit confirmation;
bounded live capture with honest capacity results; natural calendar dates in replay grounding.
Each ends with the QA standing-orders role.

Live Workers AI calls: None (0 calls, 0 input tokens, 0 output tokens, 0 neurons).
Offline injected response usage is synthetic and is not counted as a real model call.

Cross-review and CI: pending no-mistakes gate. Owner merge remains separate.

VERIFIED: 15/15 synthetic replay cases (0 live, 15 synthetic-engine); 160 offline tests with and without credentials before the round 1 fix, 55/55 eval tests and 169 collected after it; natural calendar dates grounded as whole ISO dates; nested contracts, expected engine displays and numeric provenance, planted recording defect red, fresh-case and memory request construction, confirmation flags, cap stop and partial accounting via injected transport, live readiness guard, no coverage loss, no application or frozen-file changes.
NOT VERIFIED: Live agent/model performance, deployed endpoint compatibility, live pass rate/date and real model usage (waiting for Anna's PR #4 merge notice, main pull and deployment); full live-run capacity under D-7's five-sandbox-per-IP cap (owner resolution needed); actual cross-session DO persistence (offline tests prove request construction only); Claude gate review and CI (pending); exact gate review prompt (not captured yet).
