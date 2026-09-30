# Engine verification evidence

The engine-v2 follow-up gives every customer and meter deterministic daily variation and quieter UTC weekends. July quantities are lower than August; all August/September monthly quantities and full serialized invoices are unchanged, including both September plan segments for customer 2. The exact historical gate review prompts have been recovered read-only from their matched Claude sessions.

Customer 1's synthetic September invoice now rates to $412.87, 38% above August ($299.18). Replaces the engine stub with deterministic graduated rating, calendar proration, tax, explanations, comparisons by meter and product, plan simulation, anomaly detection, duplicate-debit claim validation and ledger balance.

Scope: src/engine/, tests/engine/, appended decisions/prompt history, and owner-requested recovery of exact text in the lane's existing 02g prompt archives. Frozen contracts and configuration are unchanged. Semantics and rounding rules are documented in src/engine/README.md.

Validation (2026-09-29 Pacific, seed-realism follow-up to published head 37893586):

- `npm ci`: exit 0; added 571 packages, audited 572 packages.
- `npm run typecheck`: exit 0; `tsc --noEmit && tsc --noEmit -p tests/agent`.
- `npm test`: exit 0; Test Files 9 passed (9), Tests 113 passed (113).
- `env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test`: exit 0; Test Files 9 passed (9), Tests 113 passed (113). Both projects block global fetch and bindings are local.
- `npx oxlint src/engine`: exit 0. `npx oxfmt --check src/engine tests/engine`: all 15 matched files formatted.

Tests added (71 cases; no skips):

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

Seed realism follow-up (three new tests, none removed):

- `shapes daily usage on every meter and customer with quieter UTC weekends`: tests all 36 customer/meter/month series for daily variation, lower mean weekend usage, positive quantities, and normal peaks below twice the median (excluding the locked spike).
- `makes July quantities and invoices differ from August for every customer and meter`: checks all 12 customer/meter July totals are lower than August and each customer's invoice differs. July invoice totals are $273.59, $372.29 and $252.76, versus August $299.18, $405.51 and $266.40.
- `preserves all August and September quantities, plan segments and invoice totals`: pins all 24 monthly meter quantities, all six totals, and customer 2's two September plan segments. August totals remain 29918/40551/26640 cents; September remains 41287/38771/26200 cents.
- Before changing the seed, the first two tests failed on constant request usage and identical July/August quantities. Planted a 500-request shift across customer 2's September plan boundary without changing its monthly quantity; the preservation test failed with 38787 cents received versus 38771 expected. Restored the code and the seed tests passed.
- A direct before/after comparison through the engine confirmed all six August/September serialized invoice objects match the captured pre-change seed exactly. Checking the detector across all nine customer-months returned only the September 18 anomaly, still 5x and $11.60 marginal excess cost.

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

Coverage comparison: `npx vitest list` collected 42 tests at origin/main (29d4887), 113 at head; 71 added, zero disappeared. The follow-up collection changed from 110 to 113: three added and zero disappeared. Previously collected tests and all frozen files are unchanged. No assertions removed or loosened.

Seed evidence:

- Two independent serialized outputs both SHA-256 `f1ded7eb99a8027ecc9c8dc72a338e5f1351c1c6596444ba28eb5d08c78fd359`.
- 1,306 normalized records including nested price, tier, invoice-line and tier-charge records; 1,104 daily usage rows (3 customers x 92 days x 4 meters), 9 invoices.
- Customer 1 September: subtotal 38,140 cents, tax 3,147 cents, total 41,287 cents ($412.87). August total 29,918 cents ($299.18); delta 11,369 cents ($113.69); change display 38%.
- Duplicate invoice debits: `le_charge_1_2026_09` and `le_duplicate_september`, each 41,287 cents, identical `billing-run:cus_1:2026-09` reference. Balance is $825.74 before a remedy and $412.87 after one full posted credit.
- Spike: `meter_requests`, September 18, quantity 15,000, baseline 3,000, `5x`, critical; marginal excess usage cost 1,160 cents ($11.60).
- Pro simulation total 35,917 cents ($359.17), difference -5,370 cents (-$53.70).
- Customer 2 changes from Starter to Pro on September 16, exercising two 15-day prorated fees. Historical expired request has a void memo and six ordered audit records, with no money movement.

Decisions appended, each `Decided by: Engine engineer under standing orders`: exact rational rating/line rounding; calendar proration/segment tiers; issued comparisons/full-month simulation; robust daily anomaly baseline/marginal cost; duplicate debit reservations/deterministic seed history; review round 1 accounting/audit corrections; authoritative current reservation snapshot; deterministic daily usage shape with stable demo invoices; exact gate prompt recovery from Claude session history.

Live model calls: None (0 calls, 0 tokens, 0 neurons).

Review: Historical Claude rounds 1 and 2 requested the corrections described above; round 3 approved. The exact first user prompt of each review session is now in its matching 02g archive: sessions 355e4e1d-3e36-45a5-91ef-c844031a9980 (2026-09-30T00:45:19.535Z), dd0da944-f145-4579-81ef-63418c4185e5 (2026-09-30T00:52:51.298Z), and 309ed48f-0650-4dca-895b-a68dadbc58fc (2026-09-30T00:58:05.310Z). Run directories, review-phase instructions, timestamps, and reviewed commit ids match each round. Exact string equality was checked against the parsed user message; no assistant responses, tool results or other session content were copied. This supersedes the original unavailable notes. The new follow-up gate and CI are pending.

VERIFIED: Engine behavior above, integer outputs and schema parsing, original six defect guards and new realism/plan-boundary regression guards observed red, 113 offline tests green, deterministic hash, 1306-record bound, all August/September quantities and invoices preserved, only the seeded spike detected, no coverage loss, frozen files unchanged, exact historical review prompts recovered with byte-for-byte text equality.
NOT VERIFIED: Deployed runtime and live model behavior (outside engine lane, no live calls); actual SQLite rowsWritten and atomic reservation/audit integration (agent lane); production tax integration (the engine uses a supplied basis-point rate); new follow-up gate and CI pending.
