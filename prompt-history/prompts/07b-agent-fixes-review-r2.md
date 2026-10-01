You are the cross-reviewer for the agent-fixes branch `feat/agent-fixes` on
annah-dev/cf-billing-copilot, round 2 of 2 full rounds. The work was written by Claude Code (the
agent fixes engineer). You are Codex, running read-only: do not edit, commit, push or comment
anywhere; your whole output is your review. You may run `npm run typecheck` and `npm test` if the
sandbox allows (both are offline).

The branch depends on the open evals PR #7 (`origin/feat/evals`) and is rebased onto it, so review
this branch's own changes: `git diff origin/feat/evals...HEAD` and
`git log origin/feat/evals..HEAD`. `evals/` and `src/contracts/` must be identical to
`origin/feat/evals` (check it). The frozen files in AGENTS.md hard rule 4 must be unchanged.

Check against: prompt-history/prompts/00-assignment.md, the kickoff
prompt-history/prompts/07-agent-fixes.md, AGENTS.md, docs/agent/cross-review.md,
docs/agent/verification.md, docs/ARCHITECTURE.md, and the new docs/DECISIONS.md entries headed
"agent:" at the end of the file.

What the branch claims, each to be verified:

1. A runtime grounding guard (src/agent/grounding.ts, src/agent/guard.ts, wired in
   src/agent/billing-agent.ts): before a reply is sent, every money amount, percentage, count and
   number must come from that turn's successful tool outputs; dates and periods may also come from
   the customer's message, using the same rule as evals/grounding.ts. Unsupported: one retry with
   a correction naming the figures (no tools), then a safe answer without them. The outcome is
   stored as assistant message metadata. Check: can unsupported text reach the client before the
   check (WebSocket chat and /turn), including on errors, aborts, continuations after a credit
   confirmation and budget refusals; is the evidence really scoped to the turn; is the retry
   budget-reserved and counted; does tests/agent/grounding-parity.test.ts really prove agreement
   with the grader; can the safe answer still contain an unsupported figure.
2. One commit per cause from evals/results/README.md's failure analysis: unknown-id errors list
   the real ids (src/ledger/ledger.ts); simulatePlan plan-id repair (src/agent/repair.ts); the
   server anomaly check for compareInvoices; the last step and any step after a pure repeat get no
   tools, an empty reply is asked for once (billing-agent.ts mustAnswer, guard.ts), and an empty
   tool list is never sent to Workers AI (model.ts noEmptyToolsMiddleware). Check each for
   correctness, for ways it could start a credit request or a write without confirmation (D-20),
   leak another customer's data, or loop.
3. Tests: tests/agent/grounding.test.ts, tests/agent/recovery.test.ts, the parity test, and the
   rewritten tests in agent.test.ts and chat.test.ts. The PR says each fix's tests go red without
   it; plant the defect where you can and confirm. Two tests were removed and rewritten (the
   unreachable MAX_STEPS + 1 extra step): judge whether coverage was lost.
4. Live evidence in tests/agent/evidence/live-evals/: do the claims in its README match run.json
   and the recordings? Is anything in it a secret, token or real personal data?
5. Money rule (AGENTS.md hard rule 1): no arithmetic on amounts outside src/engine and formatUsd.

Round 1 (prompt-history/prompts/07a-agent-fixes-review-r1.md) found one major defect: the
guard read a continuation's earlier tool outputs from client-controlled history positions. The
fix is commit "fix(agent): keep grounding evidence server-owned across a credit confirmation"
(`continuationEvidence` and the `awaiting_evidence` key in src/agent/billing-agent.ts). Verify the
fix, including stale or concurrent runs, a continuation that is not a credit confirmation, and
whether a client can make a stored row apply to the wrong run; then review the whole branch again,
not only the fix. A commit after round 1 also made a thrown retry fall back to the safe answer.

Report defects in or caused by this branch. Mark anything you cannot verify UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), then numbered findings, most severe
first, each with severity (blocker, major, minor, nit), file and line, what is wrong, and the fix
you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
