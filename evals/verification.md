# Evals verification evidence

Live capture is complete; the repo done-contract is not passing. Main was fetched and this lane
rebased onto merged PR #4 (`2af8f1d`). The original offline gate's two fix commits were recovered
before rebase. Scope remains evals/ and append-only prompt/decision files. Frozen files and
application code are unchanged; merged main's prompt/decision text remains a byte-identical prefix.

## Local-dev capture, 2026-09-30

Anna authorized real Workers AI through local dev before release deployment, one full set and
failing-only reruns, with no loops or cap increases. Base URL: `http://127.0.0.1:5173`.

- Full run: 15 cases / 17 turns, 6/15 pass (40%), 46 model calls, estimated 3,687 neurons.
- One failing-only rerun: 9 cases / 11 turns, 1/9 pass, 33 model calls, estimated 2,999 neurons.
- Total: 79 model calls, 225,252 input tokens, 3,246 output tokens, estimated 6,686 neurons.
- Current snapshot: 7/15 pass, combining first-run passes with one passing rerun. All 15
  recordings have live provenance. Both attempts are archived unchanged as response data.
- Four sandboxes: read-only questions together; separate duplicate-credit, plan-memory and
  credit-memory groups. Reruns reuse those ids and message accounting. No cap raised, no
  approver token persisted, no approver decision made, no further real model calls planned.
- `/api/health` succeeded before capture and did not call the model. Local dev was stopped
  after capture. Capture configs remain excluded from `npm test`; tests use stubbed AI.

`results/README.md` details the failures and run artifacts. Every results JSON includes URL,
UTC date, environment `local dev`, reported model call count and estimated neurons. The estimate
uses the pinned helper on each turn's token totals; it is not a Cloudflare meter reading.

The first grade was 4/15 due to an ISO-month count false positive. A regression reproduces
`2026-09 invoice` being treated as `09 invoices`; correcting that parser and regrading offline
produced 6/15, with no new model call or response change. The original grade remains in
`initialGrading` and the correction has `regradedAt`.

## Validation at this head

- `npm ci`: exit 0; added 571 packages, audited 572 packages; pinned lock unchanged.
- `npm run typecheck`: exit 0; `tsc --noEmit && tsc --noEmit -p tests/agent`.
- `npm test`: exit 1; Test Files 1 failed / 18 passed (19); Tests 8 failed / 259 passed (267).
- `env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test`: exit 1 with the same 8 failed / 259
  passed (267). Every failure is a captured live answer, not a network/credential failure.
- Formatting and diff whitespace checks run on lane-owned files. No global formatter ran on
  existing prompt/decision text; no frozen files were edited.
- `npx vitest list --json`: origin/main collects 190 tests, head 267. Comparing project,
  relative test file and full name found zero disappeared tests, 77 added, zero new skips.
  Main collection used an archive of `2af8f1d` with the identical installed pins.

Eight remaining replay failures are intentionally visible:

`september-invoice`, `request-tiers`, `tax-line`, `august-september-change`, `pro-simulation`,
`scale-simulation`, `remember-plan`, `remember-credit`.

The other seven replay cases and the source report pass. All 61 standalone harness checks pass.
Failed tool inputs/outputs, fabricated numbers or missing expected displays remain failures;
no assertion was removed, no bad recording rewritten and no case skipped to make tests green.

## Defect and behavior evidence

- Actual live September answers on both attempts say "7 lines" for the engine's six-line invoice.
  Replay reports `ungrounded count 7 lines` and `ungrounded number 7`.
- The dedicated count question asks for invoice lines including tax; its expected count comes
  from `engine.buildInvoice(engine.seed(), ...).lines.length` and passes in the live answer.
- `rejects an incorrect line count ... even if that number appears elsewhere` covers both
  `7 lines` and `seven invoice lines`, with seven deliberately planted in another tool field.
- `grounds an invoice line count from the engine's actual line array` proves valid counts.
- `rejects invented counts outside money and invoice lines` covers written numbers;
  `checks signed, fractional and compact numeric tokens` covers -99, 1e9, 1/99 and 99k;
  four `rejects an invented amount written as ...` cases cover singular/plural money words;
  `grounds a singular invoice and ordinal line reference` checks valid object/position counts.
- Natural-date tests cover named/abbreviated dates, yearless dates, wrong dates, fabricated dates
  made from separate components, timestamp days and month-year wording. The last old gate
  finding was reproduced red (`ungrounded number 2026-10`) before correcting timestamp month
  grounding. `does not mistake an ISO month next to invoice for a count` covers the live grader bug.
- Existing money fabrication, missing expected amounts, unsupported formats, nested tool schema,
  failed tools, customer/turn mismatch, proactive anomaly and future-output provenance checks
  remain. The original planted `$999,999.99` recording run failed one case with 14 passing;
  the mutation restored original bytes and was observed green before any live capture.
- Offline transport tests cover all three budget/cap/rate stops at create and turn, failure
  accounting, partial memory capture, new requests with no client history, discarded tokens,
  default loopback URL validation, grouping within caps, and reuse of known rerun sandboxes.
- Fixture generation remains explicit, engine-backed and refuses live overwrite. Guard tests
  construct synthetic engine responses in memory independently of failing live fixtures.

## Review and delivery

The earlier offline gate (`01M3R7B6ANF0QPEFS9F3Z2G9DX`) performed two full reviews and a delta-only
third. It found natural dates, timestamp dates and month grounding, plus a provenance-reporting
suggestion. Its fixes were preserved; the remaining month issue is corrected in this live phase.
The exact generated prompts were not exposed by `axi logs --step review --full`; identifying
logs are copied into the three 05g archives, and author context is separately identified.
A new review/PR/CI for the expanded live scope remains pending. No merge or deployment performed.

The release lane must run against `https://cf-billing-copilot.anna-hester.workers.dev` after
owner deployment and use that result in the public README. Local performance is not a deployed
pass-rate claim. Outstanding model/tool-selection failures belong to the agent lane.

VERIFIED: Merged-main rebase with preserved fixes; all 15 cases captured locally and one failing-only rerun; 79 calls and estimated 6686 neurons; immutable response archives and honest target/date/results; seven live replay passes and eight demonstrated failures; every-number/count/date/schema guards; 259 passing offline tests with and without credentials; no coverage loss or frozen/application changes; historical review identifying logs retained.
NOT VERIFIED: A passing done-contract (eight genuine replay failures remain); a deployed run/public README pass rate (release lane after deployment); current expanded-scope gate/PR/CI (pending); exact historical generated review prompts (not exposed); Cloudflare-measured neurons (token-based estimate only); human approval of the new live credit (intentionally not performed).
