# Billing evals

Fifteen cases cover invoice explanations (including tax, tiers and mid-month proration),
month comparisons, plan simulations, the September usage spike, duplicate-charge credits,
historical expiry, and memory follow-ups. Expected amounts are computed in `buildCases()`
by calling `engine` on `engine.seed()`. No expected cents or money displays are handwritten.
Application code, contracts, scripts and root test configuration are unchanged.

## Offline replay

```sh
npm test
```

The existing unit project includes `evals/**/*.test.ts`. Live tests end in `.live.ts` and
fixture generation ends in `.fixture.ts`; neither runs in `npm test`. Both test projects
block global fetch. Live-runner tests inject a synthetic transport and make no network calls.

Recordings use format version 1: case id, seed version, provenance, timestamp and an ordered
list of customer ids, `TurnRequest`s and `TurnResponse`s. The HTTP envelope and every tool
input/output are validated with the frozen contracts. Replay checks the exact question,
confirmation flag and customer, every expected amount as its engine display, expected
quantities/ratios, and key meanings such as pending approval or a proactive usage spike.
Each money-looking string must trace to a validated tool output from the same or an earlier
turn in the recording. Numeric tokens outside money must also trace to tool output.
Future responses cannot ground an earlier answer.

The current committed recordings have `source: "synthetic-engine"`, `recordedAt: null` and
zero model usage. They prove harness behavior, not model performance. Their prose is generated
from the case expectations and engine outputs. They are deliberately marked synthetic until
PR #4 merges, main is pulled, and one live run replaces them with real responses.

Generate or refresh synthetic fixtures with:

```sh
npx vitest run --config evals/vitest.fixture.config.ts
npx oxfmt --write evals/recordings
```

The generator refuses to replace live recordings. Never hand-edit generated recordings or
expected values to make a failure pass. Fix a defective expectation in the case builder or
report an agent failure, preserving the recorded response.

## One live run, after the owner's merge notice and deployment

First pull main as instructed by Anna and ensure the deployed build includes PR #4 and D-20.
No live model outputs may be recorded before that notice. Then run once:

```sh
EVAL_LIVE_READY=1 EVAL_BASE_URL=https://YOUR-WORKER.workers.dev npm run eval:live
```

`EVAL_LIVE_READY` acknowledges those prerequisites; it does not query GitHub or deploy.
The origin comes from the environment; no account credentials are needed. CI is explicitly
refused. The run creates one fresh sandbox per case, sends 17 turns in total, validates and
re-records each response, and writes `evals/results/latest-run.json` after each attempted case.
Each memory follow-up sends a new HTTP request with no client history to the same sandbox
and customer. Only the two credit-start turns carry `confirm: true`; other requests carry
`confirm: false`. No approval decisions are made, and approver tokens are discarded.
The September invoice and comparison require the proactive anomaly in the answer without
requiring the model to choose any particular tool.

There are no retries. The first `budget_exhausted`, `cap_reached` or `rate_limited` stops the
run immediately. Other HTTP, schema or transport failures also stop it. Failed answers are
saved unchanged so replay exposes them. Results include UTC run date, attempted/completed/
passed counts, a pass fraction over all 15 planned cases, stop code, turns posted, and
reported model calls and input/output tokens. In-progress snapshots say `running`; capped
runs say `stopped` and do not claim completion. The contract does not expose neurons, and a
transport failure can leave actual usage unknown; do not infer a neuron count from tokens.

D-7 permits five new sandboxes per IP per UTC day. A 15-case run on the ordinary deployed
configuration will stop at that cap, possibly earlier if demos consumed capacity. This
harness respects that policy. A complete live run requires an owner-approved resolution of
that capacity constraint; this lane does not change caps, reuse case sandboxes, spoof an IP,
or retry over reset boundaries. Record the stopped run honestly if capacity is unchanged.

Review the generated results/recordings, run `npm test`, and commit them through the usual
gate. A mixed snapshot after a stopped run can include prior synthetic recordings; report
live completed counts from the results file, never equate replay passes to live passes.
