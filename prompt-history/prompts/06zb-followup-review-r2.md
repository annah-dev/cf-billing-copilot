# PR #15 (fix/panel-sweep-diagram) cross-review, round 2 (full)

You are reviewing pull request #15, branch `fix/panel-sweep-diagram`, authored by Claude Code
(release engineer) at the owner's request (prompt-history/prompts/06x-release-owner-c1-a1-b1-diagram.md
and 06y). You are read-only: do not edit, commit, push, rebase or merge anything, and make no
network calls or live model calls.

The diff under review:

    git diff origin/main...origin/fix/panel-sweep-diagram

Check it against the owner's instruction (06x), AGENTS.md, docs/agent/cross-review.md ("What the
reviewer checks"), docs/agent/verification.md and the appended docs/DECISIONS.md entries.

Focus on:

1. Panel follow-up (src/ui/api.ts `followUpCreditRequest`, src/app.tsx, src/ui/chat.tsx). Does it
   start only on a confirmation (approved true), read at most five times, stop when a request not
   seen before leaves "requested", on a failed read and on unmount? Can a stale `panel` closure
   make it miss the new request or stop early? Can its reads race the focus refresh or a customer
   switch (generation counter, mounted flag)? Is the focus refresh kept? Does the README still
   mention a manual Refresh anywhere in the demo or the release checklist?
2. idleSweep (src/agent/billing-agent.ts). Is `{ idempotent: false }` correct against the
   installed SDK (`node_modules/agents/dist/index.js`, `schedule` and the onStart warning)? Does
   `armIdleSweep` still keep exactly one pending row on every path (onStart, touchActivity,
   idleSweep re-arm)? Does the new test really go through the alarm (`runDurableObjectAlarm`),
   and would it fail with `idempotent: true`?
3. Diagram. docs/architecture.excalidraw and docs/architecture.svg must be byte-identical to what
   the owner supplied (the PR copies them unchanged; you cannot see the originals, so check they
   are valid Excalidraw JSON and a self-contained SVG with no scripts or external references, and
   mode 644). Are the embeds and the "opens at excalidraw.com" notes correct, with relative paths
   that render on GitHub? Spot-check the PR's label-check list against the code: is anything listed
   as wrong actually right, or anything important missed?
4. Rules: no frozen file changed (src/contracts, wrangler.jsonc, package files, vitest config,
   tsconfig, .github, AGENTS.md), plain ASCII in docs and comments, DECISIONS and PROMPTS.md
   append-only (the regenerated chronological index at the end of PROMPTS.md is the only rewritten
   block), and VERIFIED / NOT VERIFIED honesty.

Round 1 (prompt 06za) requested one change, which the author fixed: a focus refresh that
superseded a follow-up read made `refresh` return null, which the helper treated as a failed read,
so polling stopped early. `refresh` in src/app.tsx now returns `SUPERSEDED` (src/ui/api.ts) when a
newer read replaced it, both on success and on error; `followUpCreditRequest` keeps its schedule on
`SUPERSEDED` and still stops on a real failure (null). New test: "keeps going when a focus refresh
supersedes a follow-up read"; turning `SUPERSEDED` back into a stop fails it. Re-check the round-1
finding, then review the whole diff again as a full round.

You may run `npm ci`, `npm run typecheck`, `npm test` and `npx vitest list` in a scratch copy if
your sandbox allows; say which you ran.

Report: a verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each with
severity (blocker, major, minor, nit), file and line, what is wrong and the fix you suggest. End
with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>
