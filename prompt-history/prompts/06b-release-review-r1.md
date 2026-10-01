# PR #14 (release) cross-review, round 1 (full)

You are reviewing pull request #14, branch `feat/release`, authored by Claude Code (reviewer and
release engineer). You are read-only: do not edit, commit, push, rebase or merge anything, and make
no network calls or live model calls (do not run `npm run dev`, `npm run eval:live` or anything that
reaches Workers AI or the deployed site).

The diff under review:

    git diff origin/main...origin/feat/release

Check it against prompt-history/prompts/00-assignment.md (acceptance criteria), the lane prompt
prompt-history/prompts/06-release.md and the owner's notes 06a, 06e and 06i to 06m, AGENTS.md,
docs/agent/cross-review.md ("What the reviewer checks"), docs/agent/verification.md and
docs/agent/plan.md (lane "release"). The PR body (`gh pr view 14`, if your sandbox has network;
otherwise say so) claims every acceptance box with evidence.

Focus on:

1. README accuracy. Every claim must match the code, docs/DECISIONS.md and the eval results:
   the four components and the files named, caps and cost figures (wrangler.jsonc vars, D-7, the
   D-7 amendment, D-13), the five-step demo and which user story each covers, setup and deploy
   commands (the UI's API mode default after PR #9), the release checklist (including the off
   switch), the eval result (evals/results/run-2026-10-01T07-35-39.703Z.json, replay.json) and the
   description of its four misses, the Llama 3.3 streaming finding against DEV-16 and D-14, the five
   owner calls in "How this was built" against the linked DECISIONS entries and PROMPTS.md entries
   (do the anchors resolve?), and that repository and deployment URLs appear only in the Links
   block. Claims about the owner are the owner's to make; flag any that the repository does not
   support.
2. The transcript export (scripts/export-transcripts.mjs and prompt-history/transcripts/). Could
   it leak secrets, tokens, emails, home paths, account ids or the owner's unrelated projects?
   Sample several .jsonl.gz files (`gzip -dc`). Is selection correct (this repo's worktrees and
   gate runs only)? Does the cross-check report honestly, and does the PROMPTS index link
   correctly? The private term list is git-ignored by design; check it is not committed.
3. PROMPTS.md and docs/DECISIONS.md: append-only respected (diff against origin/main must remove
   no line), late entries 51 to 57 match their prompt files and their transcript source, entry 24's
   annotation is factual, every DECISIONS entry ends with "Decided by", and the eval result files
   changed only as the evals README's regrade procedure allows (recordings replaced by the deployed
   run, earlier runs archived, older run files changing only `regradedAt`).
4. Rules: no application code changed (src/, tests/ except none, wrangler.jsonc and other frozen
   files untouched), plain ASCII in docs (verbatim prompt text exempt), done-contract evidence,
   and VERIFIED / NOT VERIFIED honesty.

You may run `npm ci`, `npm run typecheck`, `npm test`, `npx vitest list` and
`node scripts/export-transcripts.mjs --prompts-index` (read-only) in a scratch copy if your
sandbox allows; do not run the export itself, which writes files. Say which you ran.

Report: a verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each with
severity (blocker, major, minor, nit), file and line, what is wrong and the fix you suggest. End
with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>
