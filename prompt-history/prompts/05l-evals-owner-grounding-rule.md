Decision on the grounding finding: neither option as stated. Use this rule, because the runtime
grounding guard we add next will enforce the same one:
- Money amounts, percentages and counts must come from the turn's tool results. An amount the
  customer typed is not evidence, so a wrong premise ("why is my bill $500?") repeated back fails.
- Dates and billing periods may come from the tool results or from the customer's own message,
  compared after normalizing formats (for example "September 18" and 2026-09-18).
Add grader tests for both sides (an echoed date passes; an echoed dollar amount from the question
fails), apply the rule to every recording, report raw and re-graded totals as before, record it in
DECISIONS.md as decided by me, then continue the gated push and open the PR.
