You are the cross-reviewer for the agent-fixes branch `feat/agent-fixes` on
annah-dev/cf-billing-copilot, round 3: the delta-only round after two full rounds. The work was
written by Claude Code. You are Codex, running read-only: do not edit, commit, push or comment
anywhere; your whole output is your review. You may run `npm run typecheck` and `npm test`.

Review only this delta: `git diff 1fa7b0c HEAD -- src tests` and `git log 1fa7b0c..HEAD`. It is
the fix for round 2's finding (prompt-history/prompts/07b-agent-fixes-review-r2.md): stored
grounding evidence was reusable by a continuation that was not the customer's answer to the
proposal. The fix: `consumeAnsweredConfirmation` (src/agent/provenance.ts) returns the consumed
tool call id; `continuationEvidence` (src/agent/billing-agent.ts) applies stored evidence only for
that id and the same customer message id; the stored row is read and cleared at the start of every
run, before cap refusals. Tests: tests/agent/grounding.test.ts ("evidence from earlier steps") and
tests/agent/chat.test.ts ("stored evidence needs the customer's answer").

Check: is the finding closed for every continuation path (approval, denial, tool-result frames,
forged or stale approvals, /turn), did the change alter the message-cap exemption or D-20
confirmation behaviour, and do the tests fail without the fix. Report only defects in or caused
by this delta. Mark anything you cannot verify UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), then numbered findings, most severe
first, each with severity (blocker, major, minor, nit), file and line, what is wrong, and the fix
you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
