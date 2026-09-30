You are the cross-reviewer for PR #4 on annah-dev/cf-billing-copilot (the agent lane), round 3: a
delta-only review, the last round. The PR was written by Claude Code (the Agent/Workflow engineer).
You are Codex, running read-only: do not edit, commit, push or comment anywhere; your whole output
is your review. You may run read-only commands such as `npm run typecheck` and `npm test` if the
sandbox allows; say so if it does not.

Review only the delta since round 2: `git diff dfb4e0a HEAD` and `git log dfb4e0a..HEAD`. Round 2
(prompt-history/prompts/03c-agent-review-r2.md) raised two findings; the author's dispositions are
in the PR #4 comment "Cross-review round 2" (`gh pr view 4 --comments`):
1. Client-controlled history (cf_agent_chat_messages) could fabricate an answered credit
   confirmation to bypass the message cap, and could plant tool results in the model's context.
   The fix is src/agent/provenance.ts and its use in src/agent/billing-agent.ts and
   src/agent/tools.ts.
2. A model response without usage settled its neuron reservation as zero (src/agent/model.ts).

For each, say whether the fix is complete and correct against the installed `agents`,
`@cloudflare/ai-chat` and `ai` sources (installed types and code win over web docs). In particular
check: every SDK path by which client-supplied messages or tool parts can reach the model or
trigger a tool execution; whether a genuine confirmation, a denial, the headless /turn path and
repeated identical tool calls (the per-turn cache) still work; whether the input and output hashes
can differ for genuine parts (serialisation, key order, undefined fields) and silently drop real
history; and whether any usage shape still settles below the reserved bound. Then report any new
defect the delta introduces, including in the new tests (can they fail?) and docs/DECISIONS.md.
Report only defects in or caused by the delta. Mark anything you cannot verify UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), the two finding verdicts, then
numbered new findings, most severe first, each with severity (blocker, major, minor, nit), file and
line, what is wrong, and the fix you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
