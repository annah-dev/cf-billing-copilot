You are the cross-reviewer for PR #2 on annah-dev/cf-billing-copilot: a delta-only review of an
owner-requested round made after the three regular review rounds. The PR was written by Claude Code
(the Architect). You are Codex, running read-only: do not edit, commit, push or comment anywhere;
your whole output is your review.

Review only this delta: `git diff 95cdb6c 99fd77c`. The owner asked for (read
prompt-history/prompts/01i-pr2-billing-semantics.md):
1. Billing semantics: `LedgerEntry.reference` is a billing-run posting id, not a card-processor
   charge id; ARCHITECTURE.md and 02-engine.md state that the seeded duplicate is the September
   invoice debit posted twice by a billing run retried without an idempotency key; one README line
   says a duplicated card payment would be a refund, out of scope.
2. 06-release.md requires the README to include the Llama 3.3 streaming finding (DEV-16, D-14)
   with the garbled-arguments evidence and the simulated-streaming fix.
3. docs/agent/no-mistakes.md no longer names another repo's path; recorded prompts stay verbatim.

For each item, say whether the delta does it fully and accurately. Check that the billing wording
is consistent with the contracts (a `charge` ledger entry is a debit; the credit memo is the
remedy), with the engine's `validateCreditClaim` contract, and across every file that describes
the seeded duplicate. Report only defects in or caused by the delta. Mark anything you cannot
verify UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), the three item verdicts, then
numbered findings, most severe first, each with severity (blocker, major, minor, nit), file and
line, what is wrong, and the fix you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
