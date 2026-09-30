Before I merge PR #2, one small round, then a delta-only Codex review:

1. Billing semantics. LedgerEntry.reference gives "a card-processor charge id" as its example, but
   a charge entry is a debit that raises what the customer owes. A duplicated card payment is
   handled as a refund or a credit balance; a credit memo is the remedy for a duplicated debit.
   Change the example to a billing-run posting id, and state in ARCHITECTURE.md and 02-engine.md
   that the seeded duplicate is the September invoice debit posted twice by a billing run retried
   without an idempotency key. Add one README line that a duplicated card payment would be a
   refund, which is out of scope.
2. 06-release.md: the README must include the Llama 3.3 streaming finding (DEV-16, D-14), with
   the garbled-arguments evidence and the simulated-streaming fix.
3. docs/agent/no-mistakes.md: say "another repo of mine that already runs the gate" instead of
   naming its path. Recorded prompts stay verbatim.

Tell me when it is ready and I will merge.
