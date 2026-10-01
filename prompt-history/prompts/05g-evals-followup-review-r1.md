# Evals follow-up review round 1

Run: 01M3TJ4KE1N1TBVAW6THCD3NZT
Step: review (round 1)
Harness: no-mistakes v1.41.2 (Claude)

Exact generated review prompt: NOT AVAILABLE. The axi logs did not expose the prompt sent to
the reviewer; only the step log and findings below were captured.

## Step log (ANSI stripped only)

```text
step: review
run: "01M3TJ4KE1N1TBVAW6THCD3NZT"
lines: 6 total
log[6]{line}:
  reviewing changes...
  ""
  claude started pid=411865
  ""
  Diff review is complete; I'm writing up the one finding now.
  claude exited pid=411865 status=success
```

## Findings JSON

```json
{"findings":[{"id":"ordinal-prefix-drops-cardinal","severity":"warning","file":"evals/grounding.ts","line":125,"description":"Any number word in the tens or hundreds placed right before an ordinal word is treated as part of a compound ordinal and erased. This happens even when that number word is a real quantity. For example, \"We saw forty first-time invoices\" or \"one hundred first-time customers\" matches the prefix group. Because the prefix starts with \"forty\" or contains \"hundred\", `compound` is true and the whole phrase becomes \" \", so the 40 or 100 never reaches the ungrounded-number check. The intent asks to preserve a standalone cardinal before an ordinal word (\"one second\"), but only the 1-19 range is preserved. This is a new false-negative path in a grader whose job is to reject ungrounded figures. \"twenty first\" is genuinely ambiguous, so how to handle it is a judgement call about grading behaviour: for example, keep the cardinal when the ordinal is followed by a hyphen or a noun-forming suffix such as \"first-time\", or add a regression test that documents the accepted blind spot.","action":"ask-user","review_scope":"source"}],"summary":"","risk_level":"low","risk_rationale":"The change only touches the eval grader and its committed results. It does not change src, contracts or frozen config. The new simulation-receipt rule is tightly specified and has tests. The regrade only adds issues and changes no pass result, and grading history is kept. The one remaining concern is a narrow ordinal-normalization blind spot in the grader.","risk_scope":"source-or-external"}
```
