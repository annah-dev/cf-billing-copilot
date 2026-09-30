# Engine verification evidence

Customer 1's synthetic September invoice now rates to $412.87, 38% above August ($299.18). Replaces the engine stub with deterministic graduated rating, calendar proration, tax, explanations, comparisons by meter and product, plan simulation, anomaly detection, duplicate-debit claim validation and ledger balance.

Scope: src/engine/, tests/engine/, and append-only decisions/prompt history. Frozen contracts and configuration are unchanged. Semantics and rounding rules are documented in src/engine/README.md.

Validation (2026-09-29, rebased on origin/main):

- `npm ci`: exit 0; added 571 packages, audited 572 packages.
- `npm run typecheck`: exit 0; `tsc --noEmit && tsc --noEmit -p tests/agent`.
- `npm test`: exit 0; Test Files 9 passed (9), Tests 110 passed (110).
- `env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test`: exit 0; Test Files 9 passed (9), Tests 110 passed (110). Both projects block global fetch and bindings are local.
- `npx oxlint src/engine`: exit 0. `npx oxfmt --check src/engine tests/engine`: all 15 matched files formatted.

Tests added (68 cases; no skips):

| Behavior                                                                                    | Test evidence                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graduated tier boundaries at one below, at, one above                                       | rating: `rates tier boundary quantity %i as %i cents` (99/100/101)                                                                                                                                                      |
| Exact once-per-line rounding and tier reconciliation                                        | rating: `rounds exact fractions once per line and reconciles tier residuals`; `rounds %i cents per %i units to %i`                                                                                                      |
| Large intermediates and overflow refusal                                                    | rating: `keeps large intermediate products exact and rejects unsafe results`                                                                                                                                            |
| Zero usage                                                                                  | rating: `rates zero usage with zero usage amount and no tiers`                                                                                                                                                          |
| First/last/mid-day proration                                                                | rating: `prorates a plan change on %s` (September 1, 30, 16); `uses actual calendar days including leap February and UTC boundaries`                                                                                    |
| Exclusive subscription boundary and segment tier reset                                      | rating: `uses exclusive plan boundaries and restarts usage tiers per segment`                                                                                                                                           |
| Tax, signed credits, isolation                                                              | rating: `rounds tax once after issued invoice discounts and ignores ledger credits, payments and memos`; `excludes credits and usage outside the period and other customers`                                            |
| Invalid inputs and missing entities                                                         | rating: `rejects %s input with EngineError` (12 defects); `returns typed missing-entity errors`                                                                                                                         |
| All line explanations parse                                                                 | analysis: `explains every seed line with contract-valid steps and tier money`                                                                                                                                           |
| Meter and product deltas reconcile                                                          | analysis: `compares all meters and products and reconciles all deltas to the total`; `handles zero baselines, decreases, and non-usage changes`                                                                         |
| Plan simulation, credits/tax, plan changes, immutability                                    | analysis: `simulates the same usage under Pro with exact credits and tax`; `reports the closing actual plan on a mid-period change and leaves data immutable`; `requires issued invoices for comparison and simulation` |
| Spike and marginal tier cost                                                                | analysis: `detects only the seeded 5x spike and estimates marginal graduated cost`                                                                                                                                      |
| Anomaly thresholds, even median, daily aggregation, zero baseline                           | analysis: `scores quantity %i against a positive median baseline`; `sums multiple daily records and excludes the candidate from an even median`; `does not divide by a zero baseline and treats missing days as zero`   |
| Explicit and inferred duplicate claim                                                       | credit: `validates explicit and inferred duplicate against the ledger`                                                                                                                                                  |
| Pending/applied reservations and void memo release                                          | credit: `subtracts pending plus applied reservations once and ignores void memos`; `refuses fully reserved or over-reserved debit (%i)`                                                                                 |
| Reservation isolation and malformed snapshots                                               | credit: `ignores reservations belonging to another charge`; `rejects conflicting snapshots and nonpositive memos`                                                                                                       |
| No credit for original charge, payment, mismatched references/amount/customer/invoice/entry | credit: `refuses a non-matching %s` (7 cases)                                                                                                                                                                           |
| Chronology independent of array order                                                       | credit: `sorts ledger chronology independently of array order and finds the next available duplicate`                                                                                                                   |
| Ledger balance                                                                              | credit: `sums signed charges minus payments and posted credits, isolated by customer`                                                                                                                                   |
| Seed hash and record cap                                                                    | seed: `produces identical SHA-256 hashes on two independent runs`; `reports normalized record count including nested tiers and stays under 2500`                                                                        |
| Demo invoices, usage matrix, expired history                                                | seed: `rebuilds every invoice and produces the demo total and 38 percent change`; `contains exactly one duplicate debit and a coherent expired request, void memo and audit trail`                                      |
| Integer output guard                                                                        | seed: `every engine output contains only safe integer numeric fields`                                                                                                                                                   |
| Forbidden imports, including type/dynamic imports                                           | imports: `engine imports only its own modules, contracts and zod (including dynamic and type imports)`                                                                                                                  |

Review corrections:

- F1: Reproduced the duplicate-debit remedy over a full invoice/posting cycle: a 50-cent ledger credit reduced the next invoice from 217 cents to 162 cents and changed tax. The regression test failed before the fix; ledger credits now affect balance only, while re-rating retains issued invoice discounts. `posts a duplicate-debit remedy once without discounting the next invoice or its tax` proves the corrected cycle.
- F2: The complete caller `existingMemos` snapshot is authoritative; stale dataset history is ignored. Conflicting copies in the current snapshot still fail. Two `uses the current %s status over a stale pending dataset snapshot` cases cover applied and void.
- Round 2 memo-snapshot-override: Reproduced a stale full reservation blocking a new claim when the current pending/applied list was empty after voiding. The regression test failed before the fix; `releases a stale dataset reservation when the current pending/applied snapshot is empty` now proves the released debit remains creditable.
- F3: Added the explicit August `money(29918)` assertion.
- F4: Added the request-subject pending transition and Workflow actors. The seed history test now asserts the requested/pending/expired progression and actors, with six audit records.

Watched defects fail, then restored code and ran the full suite green:

- Injected balance output with `cents: 0.5`: integer-output test exited 1.
- Removed half-cent rounding adjustment: fractional rounding cases exited 1.
- Ignored pending reservations in claim validation: reservation test exited 1.
- Added an `ai` type import: import guard exited 1.
- Randomized seedVersion: two-run hash test exited 1.
- Added 2,500 usage rows: record-cap test exited 1.

Coverage comparison: `npx vitest list` collected 42 tests at origin/main (29d4887), 110 at head; 68 added, zero disappeared. Existing tests and all frozen files are unchanged. No assertions removed or loosened.

Seed evidence:

- Two independent serialized outputs both SHA-256 `7e720f0be22180c36fca7552af77b941c0243e4a10bc9929bdd42f8a5d21b557`.
- 1,306 normalized records including nested price, tier, invoice-line and tier-charge records; 1,104 daily usage rows (3 customers x 92 days x 4 meters), 9 invoices.
- Customer 1 September: subtotal 38,140 cents, tax 3,147 cents, total 41,287 cents ($412.87). August total 29,918 cents ($299.18); delta 11,369 cents ($113.69); change display 38%.
- Duplicate invoice debits: `le_charge_1_2026_09` and `le_duplicate_september`, each 41,287 cents, identical `billing-run:cus_1:2026-09` reference. Balance is $825.74 before a remedy and $412.87 after one full posted credit.
- Spike: `meter_requests`, September 18, quantity 15,000, baseline 3,000, `5x`, critical; marginal excess usage cost 1,160 cents ($11.60).
- Pro simulation total 35,917 cents ($359.17), difference -5,370 cents (-$53.70).
- Customer 2 changes from Starter to Pro on September 16, exercising two 15-day prorated fees. Historical expired request has a void memo and six ordered audit records, with no money movement.

Decisions appended, each `Decided by: Engine engineer under standing orders`: exact rational rating/line rounding; calendar proration/segment tiers; issued comparisons/full-month simulation; robust daily anomaly baseline/marginal cost; duplicate debit reservations/deterministic seed history; review round 1 accounting/audit corrections; authoritative current reservation snapshot.

Live model calls: None (0 calls, 0 tokens, 0 neurons).

Review: Claude round 1 (run 01M3QWB6JATFWSRR2R0NM5EQT4) requested four changes; all addressed above. The review prompt text was not available in the full gate log; identifying log lines are archived in prompt-history/prompts/02g-engine-gate-review-r1.md. Round 2 (run 01M3QWSDJSEXG17YCQR3RV6VC6) found one remaining stale snapshot issue, addressed above. Its identifying log lines are archived in prompt-history/prompts/02g-engine-gate-review-r2.md. Round 3, the final delta-only review (run 01M3QX317VM98FCJ02Y5GRBYVF, `git diff 17eabcf...HEAD`), returned no findings at low risk; its identifying log lines are archived in prompt-history/prompts/02g-engine-gate-review-r3.md. CI pending.

VERIFIED: Engine behavior above, integer outputs and schema parsing, six defect guards observed red, 110 offline tests green, deterministic hash, 1306-record bound, no coverage loss, frozen files unchanged.
NOT VERIFIED: Deployed runtime and live model behavior (outside engine lane, no live calls); actual SQLite rowsWritten and atomic reservation/audit integration (agent lane); production tax behavior and zero-baseline anomalies (documented demo limitations); exact Claude round 1 prompt text (not exposed by gate logs); exact Claude round 2 and round 3 prompt text (not exposed by gate logs); CI pending.
