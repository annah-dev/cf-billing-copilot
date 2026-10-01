You are the cross-reviewer for branch `fix/prod-chat` on annah-dev/cf-billing-copilot, round 2 of
2 full rounds. The work was written by Claude Code (agent fixes engineer). You are Codex, running
read-only: do not edit, commit, push or comment anywhere; your whole output is your review. You
may run `npm run typecheck` and `npm test` (offline).

Diff: `git diff origin/main...HEAD` and `git log origin/main..HEAD` (main was merged in twice;
review this branch's own changes). Check against prompt-history/prompts/08-prod-chat-fixes.md (the
owner's request), AGENTS.md, docs/agent/verification.md, docs/agent/cross-review.md,
docs/ARCHITECTURE.md and the new docs/DECISIONS.md entries headed "agent:" near the end, plus D-14
and "agent: model settings, budget estimate and history", which were edited in place.

Claims to verify:
1. Credit confirmation failure in the chat UI: the UI sent both the SDK's cf_agent_tool_approval
   (autoContinue) and a second full-conversation request (sendAutomaticallyWhen), which raced.
   src/ui/chat.tsx drops sendAutomaticallyWhen; toolErrorText logs the raw error. Check against the
   installed agents/@cloudflare/ai-chat sources that one continuation per confirmation remains
   (approve and cancel), and that tests/ui/live-chat.test.ts proves the wiring.
2. No confirmation for an unvalidated invoice: needsApproval in src/agent/tools.ts checks the
   invoice; an unknown one fails in execute before any write; a call that skipped confirmation can
   never write; provenance marks a call as awaiting confirmation only for a real
   tool-approval-request. Look for any path that records a credit request without the customer's
   confirmation (D-20), including /turn, transient Ledger failures and forged frames.
3. WebSocket frames counted like /turn: src/agent/frames.ts and admitFrame/refuseFrame in
   src/agent/billing-agent.ts gate frames (rate limiter, API cap, length, message cap) before the
   SDK stores anything; chat turns are not charged twice. Check every frame type the installed SDK
   handles, hibernation (connection state), refusal frames the client understands, and that
   continuations keep the cap exemption rules.
4. Every tool validates its input inside execute; D-14 and the model-settings entry now match the
   code (check each statement against src/agent/model.ts and billing-agent.ts).
5. Live evidence: tests/agent/evidence/live-evals/ (remember-credit section) and
   tests/agent/evidence/live-ui/2026-10-01-credit-confirmation/: do the README claims match the
   logs and run reports; any secret or token?

Round 1 (prompt-history/prompts/08c-prod-chat-review-r1.md) found: cf_agent_state frames bypassed
the gate; older `content` message shapes bypassed the length check; a refused confirmation showed
no reason; the model-call bound ignored SDK retries. The fixes are in commit "fix(agent): close the
frame gate review findings" (frames.ts, refuseFrame and BillingRefusalMessage in billing-agent.ts,
errorBody in src/http/errors.ts, chatRefusal in src/ui/errors.ts and its use in src/ui/chat.tsx).
Verify them, including every frame type the installed SDK persists, then review the whole branch
again, not only the fixes.

Report defects in or caused by this branch, most severe first. Mark anything you cannot verify
UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), then numbered findings, each with
severity (blocker, major, minor, nit), file and line, what is wrong, and the fix you suggest. End
with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
