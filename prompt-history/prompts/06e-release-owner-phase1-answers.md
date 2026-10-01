A: put "live is the default for production builds" and the item 5 admin re-fetch fix into a
small separate PR now, so it merges before the final deploy. No redeploy now; I deploy once,
after the remaining PRs merge. B: items 2, 3 and the WebSocket finding go to the agent-fixes lane
as a follow-up PR. Item 6: keep the README note; it resolves itself after October 2.
C2, edits:
- Replace "made the product, security and cost decisions" with "made the decisions reserved to
  the owner (product scope, security model, cost and contract changes), each marked 'Decided by:
  Anna' in docs/DECISIONS.md, while agents decided implementation details under the written
  decision rights in AGENTS.md".
- Keep "merged every pull request" only if it is still true when you open the release PR.
- Add: "Planning, decision review and independent verification of each pull request were done in
  a separate Claude conversation; see the note at the top of PROMPTS.md."
D1, and annotate the 04l entry with what you find about it rather than removing it.
E1. Also store the transcripts gzip-compressed (one .jsonl.gz per session) so the repository
stays small, with every file under 50 MB. I will review scripts/scrub-terms.local.txt myself.
Phase 2 starts when I tell you the agent PRs, the grader PR and your UI PR have merged and I
have redeployed.
