# Evals verification evidence

The harness now checks committed verdict stability, not model perfection, as Anna instructed
in 05h-evals-verdict-tests.md. Negative model results stay visible while the offline suite passes.
The lane was rebased onto merged PR #4 (`2af8f1d`), preserving the historical gate's fixes.
Scope is evals/ and append-only prompts/decisions. Frozen files and application source are unchanged;
main's existing PROMPTS.md and DECISIONS.md bytes remain intact.

## Local-dev model evidence, 2026-09-30 UTC

Base URL: `http://127.0.0.1:5173`, environment `local dev`, real Llama 3.3 via Workers AI.
Anna authorized this target before release deployment, one full run then explicit failing-only
reruns, no loops and no cap increases. No model calls were made during the harness redesign.

| Capture                                              | Raw grade | Corrected grade | Model calls | Estimated neurons |
| ---------------------------------------------------- | --------- | --------------- | ----------- | ----------------- |
| Full set, 20:42:51 UTC, 15 cases / 17 turns          | 4/15      | 9/15 (60%)      | 46          | 3,687             |
| Failing-only rerun, 20:47:12 UTC, 9 cases / 11 turns | 1/9       | 2/9             | 33          | 2,999             |
| Total usage across both captures                     |           |                 | 79          | 6,686             |

Reported tokens: 225,252 input, 3,246 output. Estimates use the pinned helper on each turn's
token totals, not Cloudflare meter readings; per-call rounding can differ. Four sandboxes:
read-only questions together, separate duplicate-credit, plan-memory and credit-memory groups.
Reruns reuse those ids and message accounting. No approver token persisted, no human approval
decision made and no further Workers AI calls planned. `/api/health` succeeded without calling
the model; local dev was stopped after capture.

The latest mixed snapshot grades 8/15 corrected versus 5/15 at capture time, not a new full run.
Tier and tax regressed on rerun. The seven latest failures are september-invoice, request-tiers,
tax-line, august-september-change, pro-simulation, scale-simulation and remember-credit.
Each failure's category, raw evidence and proposed agent/prompt/grader fix is in
[results/README.md](results/README.md). No agent fix was implemented here.

## Verdict and correction evidence

- Every active and archived recording is regraded and compared with exact committed verdicts
  and issue lists: 15 active cases plus 24 archival cases. Source/seed/schema, digest, archive
  completeness, latest-attempt provenance, raw/corrected totals and usage are also checked.
- `results/replay.json` contains the active verdicts, capture-time grades, target/date/usage,
  and SHA-256 digests for all 39 recording files. Run files retain `initialGrading`, intermediate
  `gradingHistory`, corrected `cases` and `regradedAt`. Aliases/snapshots are not extra usage.
- All 39 recording files remain byte-identical to the captured evidence at a852b66. The current
  grading rules were reapplied to every one, using the explicit offline all-recordings command.
  Tests never write recordings or regenerate verdicts. No per-answer override exists.
- Every correction is listed with its reason and unit evidence in results/README.md: natural
  date wording, calendar days from timestamps, month/year from timestamps, every-number/count
  coverage, ISO-period count false positives, rejected-tool recovery and the credit receipt guard.
  The first four were established before capture; the last two explain the raw/corrected gap.
- Natural-date, timestamp and month regressions were observed red before their fixes. The ISO
  count false positive was observed in the first live grade (4/15, then 6/15). Rejected-tool
  strictness was observed in the recovered live answers (then 9/15 full and 2/9 rerun). Corrected
  graders still reject wrong dates, failed-input evidence and missing credit receipts.
- Known-good engine answers for all 15 cases cover all six stories. Known-bad guards cover
  fabricated money/numbers, missing displays/meaning, natural-date fabrication, malformed
  successful tool payloads, failed-output provenance, future-turn evidence and missing receipts.
- Actual September answers on both attempts say "7 lines" while getInvoice returns six. Replay
  keeps `ungrounded count 7 lines` and `ungrounded number 7` as negative verdict evidence.
  Dedicated count-question expectations come from engine invoice `.lines.length` and pass live.
  Unit tests reject both `7 lines` and `seven invoice lines` even with scalar seven elsewhere.
- To prove exact-verdict comparison, planted a grader-only extra issue before checkReplay's
  return. Filtered september-invoice replay went red: 1 failed / 40 filtered skips of 41, with
  `Planted verdict change for harness verification` in the diff. Its pass boolean stayed false,
  proving issue changes cannot silently pass. Restored grader bytes; recordings/results unchanged.
  The final full suite has no skips. The earlier planted `$999,999.99` recording also went red
  (one failed / 14 passed), was restored byte-for-byte and was green before live capture.
- Offline transport tests cover cap/budget/rate stops, failure accounting, partial memory capture,
  no client history on reopened sessions, discarded tokens, target validation, grouping and
  sandbox reuse. Stable archive run dates are tested with a clock that advances between run and
  case starts. Live capture archives automatically, with case timestamps preserved.

## Commands and collection

- `npm ci`: exit 0; added 571 packages, audited 572 packages; pinned lock unchanged.
- `npm run typecheck`: exit 0; `tsc --noEmit && tsc --noEmit -p tests/agent`.
- `npm test`: exit 0; Test Files 19 passed (19); Tests 309 passed (309), no skips.
- Credential-free command: `env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test`.
  Exit 0; Test Files 19 passed (19); Tests 309 passed (309), no skips.
- `npx vitest list --json`: main at 2af8f1d collects 190 tests, head 309. Compared project,
  relative file and full name: zero disappeared, 119 added. The baseline used an archive of
  main with identical installed pins. Existing 15 replay case names remain, with owner-authorized
  verdict-comparison assertions; known-good and known-bad grading assertions stay independent.
- Formatting and whitespace checks cover lane-owned files only. No global formatter touched
  old prompt/decision text; no frozen files or dependencies changed.

## Review and delivery

The previous offline gate (01M3R7B6ANF0QPEFS9F3Z2G9DX) performed two full reviews and a delta-only
third. Natural-date and timestamp fixes were recovered before rebase; the remaining month issue
was fixed afterward. Exact generated prompts were not exposed in review logs; identifying logs
are in 05g-r1/r2/r3. The prior live-scope gate retry rejected the stale local branch ref before
review. Anna now explicitly authorizes updating that local ref after green harness tests, retaining
its old head, and retrying gated push/PR creation. The new intent is logged in 05i.

New cross-review, gated delivery, PR and CI evidence will be added after they execute.
No merge or deployment is authorized. Release owns the deployed run after UI/deploy and must use
that result for the public README. The standalone live/regrade tools are excluded from npm test,
and both test projects prohibit global fetch.

VERIFIED: Local-dev real model captures and reported usage; unchanged response evidence; raw/corrected grades and shared all-recordings regrade; exact verdict/digest/provenance replay; seven failures reported without making tests fail; known-good/bad grader guards including seven lines for six; planted grader change observed red; 309 passing offline tests with and without credentials; typecheck/npm ci; 119 added tests with no coverage loss; unchanged frozen/application source.
NOT VERIFIED: New-scope cross-review/gated PR/CI until executed; deployed run/public README pass rate (release lane after deploy); exact historical generated review prompts (not exposed); Cloudflare-metered neurons (estimate only); human approval of new live credit (intentionally not performed); proposed agent/prompt/grader fixes in failure analysis (not implemented).
