# Billing engine semantics

All entry points are pure and validate their inputs and outputs using the frozen
contracts. Missing entities throw `EngineError("not_found")`, malformed input or
ambiguous subscription coverage throws `EngineError("invalid_input")`. Invoice
comparisons use issued invoices; building an invoice re-rates the dataset.

Rating accumulates exact BigInt fractions. The single rounding rule is nearest
integer cent, with ties away from zero. Rounding happens once per usage line,
prorated fee line, and invoice tax line. Tier amounts allocate cumulative rounding
differences so they sum to the rounded line; they are not independently rounded
tier invoices. No BigInt or fractional amount escapes a contract. Safe integer
overflow is rejected.

Subscriptions cover every day of a UTC calendar month exactly once. `to` is
exclusive. Each plan segment has its own graduated usage tiers; thresholds are
not prorated. Fees use active calendar days divided by days in the month. Zero
usage produces a zero usage line with no tier charges. Invoice credits are
positive totals and negative lines: re-rating preserves discount lines from an
issued invoice for the same customer and period. A new invoice has no discounts
unless they are already materialized in that invoice. Ledger credit postings
affect balance only: copying them into invoice charges would remedy the same
debit twice. Pending and void memos move no money. Tax applies once to the
nonnegative subtotal after invoice discounts; excess discounts can produce a
negative invoice total. There is no production tax engine.

Percent values carry signed basis points rounded half away from zero; the display
rounds those basis points to a whole percent. A zero prior total has no relative
percentage. Multiples carry integer hundredths with trailing display zeros
removed. Money strings come only from the contracts' `money` / `formatUsd`.

Comparisons include each meter and signed non-usage differences. The summary
aggregates meters by product. Simulation retains issued invoice discounts and recomputes
tax; its actual plan is the issued invoice's closing plan if a plan changed.

Anomalies use a leave-one-day-out median of the other daily totals for the same
meter in the month. Missing days count as zero; an even median rounds half away
from zero. A positive baseline and at least 3x usage are required: 3x is info,
4x warning, 5x critical. Zero baselines are not scored. Excess cost re-rates
usage after removing only the anomalous day's excess, so marginal tiers and
rounding are respected; it excludes tax, fee, and credits.

A duplicated debit has the same customer, invoice, charge kind, amount, and
billing-run reference as an earlier posting (ordered by timestamp, then id).
The earlier entry is never creditable. Payments are outside this claim type.
Pending plus applied memos from the dataset and caller reserve the duplicated
entry; repeated memo ids are counted once. The caller's `existingMemos` is the
current transactional snapshot and overrides stale dataset statuses; conflicting
immutable fields (request, charge, amount) are rejected.
Validation is pure; the Ledger must check and reserve in the same transaction.

Seed `engine-v1` has 3 fictional customers (`cus_1` is the demo), 4 meters, 3
plans, 92 days of daily usage, 9 invoices, and one September plan change for
`cus_2`. Customer 1 has August total $299.18 and September total $412.87 (38%
displayed change). Requests on September 18 are 15,000 versus the 3,000 baseline.
The September invoice debit posts twice on October 1. Its historical request
expires October 2 after 24 hours; the void memo releases the full reservation.
These dates are synthetic fixture history, independent of the current clock.

Derived invoice and line identifiers use deterministic 64-bit FNV-1a over their
keys to keep identifiers within the frozen slug length. These are internal
fixture identifiers, not security tokens.
