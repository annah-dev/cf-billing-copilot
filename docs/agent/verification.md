# Done-contract

"Done" means every command below passes on the PR's head, and the PR body carries the evidence this
file asks for. A claim without its evidence is not done.

## Commands (every PR)

    npm ci
    npm run typecheck
    npm test

`npm test` must pass offline and without Cloudflare credentials. CI runs the same three commands
on every PR (.github/workflows/ci.yml). To prove the offline property locally:

    env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test

## Evidence every PR body carries

1. **Summary**: what changed and why, in a few lines.
2. **Validation**: each command above with the tail of its output (test counts, not just "passed").
3. **Tests added or changed**: the test names, and for each behaviour claimed, the test that proves
   it. When a test is meant to catch a defect, say how you watched it fail (plant the defect, run,
   see red, remove it).
4. **Coverage that disappeared**: compare the tests collected at `origin/main` and at the head
   (`npx vitest list` at each) and account for every test that is gone.
5. **Lane-specific evidence** (below).
6. **Decisions**: entries appended to docs/DECISIONS.md, each with "Decided by".
7. **Live model calls**: how many were made while building the PR, for what, and the tokens or
   neurons reported. "None" is a valid answer and the expected one outside the agent and evals
   lanes.
8. **VERIFIED / NOT VERIFIED**: end with both lines. NOT VERIFIED names everything claimed or
   touched that was not exercised, and why. It is never omitted and never "nothing" unless that is
   literally true.

## Lane-specific evidence

- engine: seed determinism (two runs, identical output hash), the seed's record count, and the
  demo-story numbers the seed produces (September total, change against August, the duplicate
  charge, the spike).
- agent: workers-pool test names for every flow in docs/agent/plan.md "agent / Done"; one local-dev
  chat turn against real Llama 3.3 with its tool calls and token usage; the credit flow driven by
  curl in local dev (request, pending, approve, applied, audit), with the transcript.
- ui: screenshots at desktop width and 390 px of chat, side panel, credit confirmation, /admin and a
  cap message; the grep showing no arithmetic on amounts outside `formatUsd`.
- evals: replay pass count inside `npm test`; the planted-wrong-number run going red; the live run's
  pass rate and date once it exists.
- release: every assignment acceptance box, each with its evidence or marked not done.

## Rules

- Never weaken a gate to make it pass: no skipped test, no loosened schema, no removed assertion
  without a stated reason in the PR body.
- Skipped tests are listed with the condition that re-enables them.
- A test that checks less than the PR claims is a defect even if the test passes.
