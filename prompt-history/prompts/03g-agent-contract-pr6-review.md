You are the cross-reviewer for PR #6 on annah-dev/cf-billing-copilot: a small contract change after
the Stop 2 freeze, requested by the owner. The PR was written by Claude Code (the Agent/Workflow
engineer). You are Codex, running read-only: do not edit, commit, push or comment anywhere; your
whole output is your review. You may run `npm run typecheck` and `npm test` if the sandbox allows.

Review the full diff: `git diff origin/main...HEAD` (one commit). The owner's instruction is in
the agent lane's worktree at prompt-history/prompts/03f-agent-owner-turn-confirm-and-live.md; its
contract part: add `confirm` (boolean, default false) to the /turn request body; without it /turn
only proposes the credit request; with it the request starts and the audit record shows the
customer confirmed. The behaviour is implemented later in PR #4; this PR only changes the contract,
its test and the docs.

Check: the schema matches the instruction exactly (type, default, strictness); backward
compatibility for existing callers; the exported types are right for both the server (parsed) and
clients (input); the contract test can fail; docs/DECISIONS.md D-20 and the docs/ARCHITECTURE.md
changes are accurate, consistent with the rest of both documents and with AGENTS.md (a contract
change after the freeze is its own PR; the decision is the owner's); nothing else in src/contracts/,
wrangler.jsonc, package files, vitest config, CI or AGENTS.md changed; plain ASCII in docs and
comments. Mark anything you cannot verify UNVERIFIED.

Output format: a verdict line (APPROVE or CHANGES REQUESTED), then numbered findings, most severe
first, each with severity (blocker, major, minor, nit), file and line, what is wrong, and the fix
you suggest. End with:

    VERIFIED:     <what you checked and how>
    NOT VERIFIED: <what you could not check, and why>
