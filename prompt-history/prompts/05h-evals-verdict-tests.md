Hold the gate retry for now. With 7 failing tests, the gate's test step would let Claude attempt
one automatic fix, and for an eval that could mean changing grading or recordings. The pass rate
must not depend on that.

Change the test design instead: npm test checks the harness, not the model.
- Replay mode re-grades the committed recordings and asserts the verdicts match the committed
  results file, so any grader change shows up as a visible diff.
- Add grader unit tests with known-good and known-bad answers, including the 7-lines case.
- Model failures are reported results, not test failures.

Grading corrections: only as a grader fix with a unit test, applied to every recording, with raw
and corrected results both reported. No per-answer overrides. List every correction you made and
why.

Then add a failure analysis to evals/results/README.md: for each failing question, the category
(ungrounded number stated, tool not called, wrong tool input, grader too strict, other), the
evidence, and the fix you would propose and where it belongs (agent, prompt, grader). Do not
change src/agent.

When npm test is green, you may update the gate's stale local branch ref, retry the gated push,
and open the PR with the results clearly labelled as a local-dev run.
