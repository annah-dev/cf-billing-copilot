# Billing evals

Fifteen engine-backed cases cover all six user stories, with 17 turns in the full set.
Expected amounts, ratios, usage quantities and invoice line counts come from `engine` on
`engine.seed()`. The invoice-count question catches an answer saying seven lines for a
six-line invoice. Application code and frozen configuration remain unchanged.

## Replay

```sh
npm test
```

The root unit project already collects `evals/**/*.test.ts`. Live capture ends in `.live.ts`
and explicit fixture/regrade tools end in `.fixture.ts`, so none execute as part of `npm test`.
Both root test projects prohibit global fetch. Harness unit tests use an injected transport.

Replay validates the recording envelope and successful tool inputs/outputs, the question/customer/
confirmation flag, engine display strings and required meanings. Every numeric claim is
checked: currency, scalar numbers, percentages, multipliers, written integer words, natural
calendar dates and counts. Array lengths ground counts and ordered entries ground numeral list
positions. Ordinal words such as "first", "second" and "twenty-first" are labels,
not figures; numerals (including "2nd") and spelled-out cardinal numbers remain checked. An invoice count must match its actual line array; an unrelated scalar seven does
not excuse "seven lines". Money amounts, percentages, counts and other numbers need the
current turn's successful tool outputs; evidence resets every turn, so an amount the customer
typed or an earlier turn's result cannot ground them. Dates and billing periods may come from
the current turn's tool outputs or the customer's own message, compared after normalizing
formats ("September 18" and 2026-09-18). Message dates ground only whole date-shaped tokens,
never a count, percentage, bare year or day number, and a day is never assembled from separate
parts. A yearless date takes its year only from one matching period; otherwise it must echo the
same yearless date from the message. Rejected calls must have null output and provide no
evidence; a later valid call can recover. Confirmed credit turns require a successful request receipt. Simulation turns, including
plan-memory turns, require a successful simulatePlan call whose input and output match the
requested plan and period and whose output matches the customer. Current-invoice amounts
that happen to match a simulation cannot supply that receipt. The report explicitly
counts live versus synthetic recordings.

Recordings are immutable model evidence. The active snapshot contains the latest captured
response for each case; archives under `recordings/runs/` preserve both attempts. Replay
compares every active and archived verdict and issue list with committed results. Model failures
are reported data; unexpected verdict changes or recording digests make the tests fail. Known-good
engine answers and known-bad answers, including seven lines for six, have independent unit tests.
See `results/README.md` for raw and corrected results, every correction and failure analysis.

After a grader fix with a unit regression, explicitly apply it to every recording:

```sh
EVAL_REGRADE_ALL=1 npx vitest run --config evals/vitest.fixture.config.ts evals/regrade.fixture.ts
```

This offline command preserves capture-time and intermediate grades, updates the corrected run
reports and `results/replay.json`, and never writes raw recordings. Review the result diff; do
not add per-answer overrides. `npm test` never regenerates verdicts.

The separate defect-guard tests build engine fixtures in memory, so a bad model response
cannot contaminate a validator regression's starting point. To generate synthetic recordings
before any live capture:

```sh
npx vitest run --config evals/vitest.fixture.config.ts evals/fixtures.fixture.ts
```

The generator refuses to replace live evidence. Do not hand-edit generated recordings or
expected values to make a failure pass.

## Deliberate live capture

Main includes PR #4 and D-20; Anna authorized local dev with real Workers AI. Start `npm run dev`
(the server's health endpoint does not call the model), then run:

```sh
EVAL_LIVE_READY=1 npm run eval:live
```

`EVAL_BASE_URL` defaults to `http://127.0.0.1:5173`. Loopback HTTP and HTTPS origins are allowed;
credentials, queries and paths are refused. CI is refused. Each results JSON includes the
base URL, UTC date, environment (`local dev` or `deployed`), pass fraction, completion/stop
state, model call count, tokens and estimated neurons from the pinned pricing helper.

Read-only cases share one sandbox. Duplicate-credit and each memory case use separate
sandboxes, preserving credit/memory isolation while staying within five creations per IP.
The full set uses four sandboxes and at most 12 messages in any one. A group that would exceed
30 messages uses a new sandbox; app caps remain enforced. Only credit-start turns send
`confirm: true`. Memory follow-ups send new requests with no client history to the same
sandbox/customer. Approver tokens are discarded and no approval decisions are sent.

There are no automatic retries. Cap, rate, budget and transport failures stop immediately.
One full run is allowed per target. A subsequent invocation must explicitly select previously
failing cases, for example:

```sh
EVAL_LIVE_READY=1 EVAL_CASE_IDS=september-invoice,request-tiers npm run eval:live
```

Reruns reuse the recorded sandbox ids and accounted message counts; they cannot rerun a passing
case. `EVAL_PREVIOUS_RESULTS` can select the prior report. Each invocation writes `run-*.json`,
the `latest-run.json` alias and archived recordings, all named by the run start date.
Completed model failures are successful captures with negative verdicts; incomplete/transport
stops still fail the live command. Capture is deliberate; never put these commands
in a loop. The owner-authorized full run and one failing-only rerun have already completed.
No more local model calls are planned for this session.

After deployment, the release lane runs the complete set against the deployed origin:

```sh
EVAL_LIVE_READY=1 EVAL_BASE_URL=https://cf-billing-copilot.anna-hester.workers.dev npm run eval:live
```

A new target permits its own full run. The public README's pass rate comes from that deployment,
not this local run. Then run the explicit all-recordings regrade command above to update replay's
committed verdicts and provenance. The release lane must respect the same caps and label
target/date/usage.
