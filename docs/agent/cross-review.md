# Cross-review

Every PR is reviewed by the harness that did not write it, without the owner in the loop
(AGENTS.md, "Decision rights"). This file is the reviewer's checklist and the author's procedure.

## Claude-authored PRs: Codex reviews

The author runs the review from its own worktree, after pushing the branch.

1. Write the review prompt to `prompt-history/prompts/<NN><letter>-<lane>-review-r<round>.md` and
   log it in PROMPTS.md (role "automated cross-review", harness "Codex CLI (codex exec, read-only
   sandbox, model_reasoning_effort=high)").
2. Run Codex headless in its default read-only sandbox:

       git fetch origin
       codex exec -c model_reasoning_effort=high -o <scratch>/review-r<round>.md \
           "$(cat prompt-history/prompts/<review-prompt>.md)"

3. Fix or rebut each finding, commit, push, and post a round summary on the PR: verdict, each
   finding with its disposition and commit.
4. Rounds: two full rounds (`git diff origin/main...HEAD`), then a third on the delta since round 2
   only, then stop. Anything still disputed goes to the owner as a FOR ANNA list with both
   positions.

A review prompt names the PR and round, says the reviewer is read-only, names the diff command,
lists the documents to check against (the assignment, the lane's kickoff prompt, AGENTS.md, this
file, docs/agent/verification.md), asks for findings most severe first with severity, file, line
and a suggested fix, and ends with VERIFIED and NOT VERIFIED lines.

## Codex-authored PRs: Claude reviews through the gate

The lane pushes with `git push no-mistakes`. Review findings park (auto_fix.review is 0); the lane
agent reads them with `no-mistakes axi status` and `no-mistakes axi logs --step review --full`,
fixes them on its branch (after `no-mistakes axi sync` when the run offers it) and pushes through
the gate again. Same convergence rule. See docs/agent/no-mistakes.md.

## What the reviewer checks

Treat every claim in the PR body as unverified.

1. **Re-run the evidence.** Run the done-contract commands. If the PR says a test catches a defect,
   plant the defect and watch it go red.
2. **Money.** No arithmetic on amounts outside src/engine/ and `formatUsd`; every amount that
   reaches the model or the UI is `Money`; integer cents everywhere; the model is never asked to
   convert, sum or round.
3. **Contracts and frozen files.** Diff src/contracts/, wrangler.jsonc, package.json,
   package-lock.json, vitest.config.ts, tsconfig.json, .github/ and AGENTS.md against origin/main.
   Any change there outside a dedicated contract PR is a blocking finding.
4. **Coverage that disappeared.** Compare `npx vitest list` at origin/main and at the head (and at
   each commit if the PR is long); account for every test that is gone. Collection proves
   presence, not enforcement: look for tests that cannot fail.
5. **Skips.** Every skipped test names the condition that re-enables it.
6. **Credit flow invariants.** Idempotency key uniqueness, the per-charge reservation, first-writer
   decisions, idempotent transitions, one audit record per transition, refusals audited once.
7. **Security.** Approver token checked in constant time on every admin route; admission checked
   before any agent or ledger route; no write reachable from a model tool beyond
   `createCreditRequest`; no secrets or tokens in code, fixtures or recordings.
8. **Live calls.** No test reaches Workers AI; any live call made while building is reported.
9. **Scope.** The PR stays inside its lane's directories plus the append-only files.
10. **The claims themselves.** A test that checks less than the PR says is a finding.

## Reporting

Verdict first (APPROVE or CHANGES REQUESTED), then findings most severe first, each with
severity, file and line, what is wrong and the fix. End with:

    VERIFIED:     <what you ran and observed>
    NOT VERIFIED: <what you did not exercise, and why>

The reviewer never pushes, fixes, rebases or merges. GitHub refuses a formal approval on a PR
opened by the same account, so the approval of record is the round summary on the PR. The owner
merges.
