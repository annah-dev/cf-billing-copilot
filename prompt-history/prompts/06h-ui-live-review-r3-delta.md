# PR #9 cross-review, round 3 (delta only)

You are reviewing pull request #9 in this repository, branch `fix/ui-live-default`, authored by
Claude Code (release engineer) at the owner's request. This is the third and last round and
covers only the changes made after round 2. You are read-only: do not edit, commit, push, rebase
or merge anything, and make no network calls or live model calls.

The delta under review (round-2 head e4bb9d4e67e4718d365bafc6b43c5514c07b29f8):

    git log --oneline origin/main..origin/fix/ui-live-default
    git diff e4bb9d4e67e4718d365bafc6b43c5514c07b29f8..origin/fix/ui-live-default

Round 2 (prompt-history/prompts/06g-ui-live-review-r2.md) requested one change: an earlier
refresh (manual Refresh, then a window focus refresh) could clear `busy` while another list read
was outstanding, so Approve became clickable and the decision follow-up overlapped that read.
The author's fix:

- `serialQueue` (src/ui/api.ts) runs tasks one at a time in call order; every admin list read
  (initial, focus, Refresh, follow-up) goes through one queue.
- `busy` is cleared only when no read is queued and no decision is in progress; a decision's
  `finally` leaves the page busy while queued reads remain.
- Two unit tests: no two reads at once with call order kept, and a failed read does not block
  the next. Planting `const run = task();` (no waiting) fails the first.
- Browser check reproducing your sequence (Refresh held 2 s, focus dispatched, then Approve):
  on the round-1 head, peak concurrent reads 2 and Approve enabled while reads were queued; on
  the new head, peak 1 and Approve disabled until the queue drained, then applied.
- DECISIONS entry "ui: Admin re-fetches until the Workflow finishes a decision" amended inside
  this PR (not yet merged) to describe the queue.

Check: does the fix hold for the round-2 sequence and for any other ordering of initial, focus,
Refresh and follow-up reads; can the queue deadlock or leak (a read after unmount, a stuck
`busy`, a lost error); do the new tests check what is claimed; are VERIFIED / NOT VERIFIED
honest. Do not re-review unchanged code except where the delta interacts with it.

Report: a verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each
with severity (blocker, major, minor, nit), file and line, what is wrong and the fix you suggest.
End with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>
