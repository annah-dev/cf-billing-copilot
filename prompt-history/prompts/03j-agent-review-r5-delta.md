You are the cross-reviewer for PR #4 on annah-dev/cf-billing-copilot (the agent lane): the final
delta-only round the owner asked for. The PR was written by Claude Code (the Agent/Workflow
engineer). You are Codex, running read-only: do not edit, commit, push or comment anywhere; your
whole output is your review. You may run `npm run typecheck` and `npm test` if the sandbox allows.

Review only these commits (the branch is rebased onto main at 49a7edd, which includes contract PR
#6):
1. f9d3c5f "fix(agent): run each turn from one conversation snapshot; migrate error_text" and
   78c87c3 (its DECISIONS entry): the round-4 fixes, never re-reviewed. Round 4
   (prompt-history/prompts/03h-agent-review-r4-delta.md) found that a chat message added while a
   confirmed /turn ran could reach the model under that confirmation, and that provenance tables
   from earlier code lacked `error_text`.
2. 4490419 "feat(agent): run the anomaly check for every invoice a turn touches": the owner asked
   (prompt-history/prompts/03i-agent-owner-anomaly-and-final-review.md) that when a turn fetches or
   explains an invoice, the server runs detectAnomalies for that period itself and gives the result
   to the model as a server-issued tool call and result, with a test that fails if the mention
   depends on the model's choice. See src/agent/anomalies.ts, src/agent/billing-agent.ts,
   src/agent/prompt.ts and the tests in tests/agent/agent.test.ts.

Use `git show <commit>` for each, and read the surrounding code as needed. Check against the
installed `ai`, `agents` and `@cloudflare/ai-chat` sources (installed code wins over web docs), in
particular: prepareStep message semantics across steps (does the injected pair reach every later
step, in a valid position and order, and never duplicate or trigger execution?), the chat stream
chunks the server writes (valid for the UI message reader, persisted, and accepted by provenance on
later turns), the per-turn cache, budget accounting (no unreserved model call), headless /turn and
D-20 confirmation, the snapshot fix under the SDK's concurrent history paths, and whether each new
test can fail. Report only defects in or caused by these commits. Mark anything you cannot verify
UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), a verdict for each of the two items,
then numbered findings, most severe first, each with severity (blocker, major, minor, nit), file and
line, what is wrong, and the fix you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
