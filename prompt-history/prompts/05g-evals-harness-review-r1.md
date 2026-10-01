# Evals harness gate review round 1

Harness: no-mistakes v1.41.2 (Claude)
Run: 01M3T67AVMBTC9CJV9A0HGDQYH

Exact generated review prompt unavailable: `no-mistakes axi logs` exposed only the run/step/version and completion lines below, not the generated review prompt.
The log is copied with a tool from /tmp/evals-verdict-review-r1.log; only ANSI colour escape sequences were stripped.

```text
A new version of no-mistakes is available: v1.41.2 -> v1.84.0
Run "no-mistakes update" to update
step: review
run: "01M3T67AVMBTC9CJV9A0HGDQYH"
lines: 6 total
log[6]{line}:
  reviewing changes...
  ""
  claude started pid=333198
  ""
  Still reviewing — now checking the grader unit tests and the committed results against intent.The review is done. I'm writing up the structured findings now.
  claude exited pid=333198 status=success
```

## Outcome and findings

Three findings: F1 (warning, ask-user, pending Anna), F2 (info, auto-fix, fixed in 05k-evals-gate-F2-fix.md), F3 (info, no-op, documented proposal).
Full findings copied with a tool from this run's scoped gate metadata /tmp/evals-verdict-review-r1-findings.json:

```json
{
  "findings": [
    {
      "id": "F1",
      "severity": "warning",
      "file": "evals/grounding.ts",
      "line": 326,
      "description": "The every-number guard only counts tool outputs as evidence, never the user's own question. So when the model repeats the period the user named, it gets flagged as ungrounded. In request-tiers, tax-line and pro-simulation the user asks about \"September 2026\", the model's refusal repeats \"September 2026\", and the only tool call was rejected. The committed verdicts in evals/results/replay.json therefore contain 'Turn 0: ungrounded number 2026-09', twice in request-tiers and tax-line. That issue is a grader false positive. It does not flip pass/fail, because these cases also miss expected values, but it is now pinned as an exact expected issue. This conflicts with evals/results/README.md:35, which says \"No remaining failure is a known grader false positive\", and the failure-analysis rows for these three cases do not mention the issue. The intent requires documenting every correction and giving each failure accurate evidence. Options: (a) under a shared grader fix, ground periods and dates that appear in the planned request message, add a unit regression, run the explicit all-recordings regrade and record the result diff; or (b) keep the strict rule and correct the README to list the echoed-period issue as a known strictness artifact. Choosing between them changes the grounding policy, so it is for Anna to decide.",
      "action": "ask-user",
      "review_scope": "source"
    },
    {
      "id": "F2",
      "severity": "info",
      "file": "evals/run.live.ts",
      "line": 38,
      "description": "The result filename takes its timestamp from its own `new Date()`, while `runDate` and the archive directory use runLive's separate `now()`. The committed artifacts already disagree: run-2026-09-30T20-42-51.599Z.json vs runDate/archive 2026-09-30T20-42-51.600Z. Tests key off runDate, so nothing breaks today. However, pairing and sorting by filename could drift from the run date, which the intent requires to be the single archive key. Build the path inside saveResult from result.runDate so all three share one timestamp. This touches only future captures; committed files stay unchanged.",
      "action": "auto-fix",
      "review_scope": "source"
    },
    {
      "id": "F3",
      "severity": "info",
      "file": "evals/results/README.md",
      "line": 46,
      "description": "A simulation answer can pass the expected-display checks without any successful simulatePlan call. In scale-simulation, amounts from the current invoice happen to match the zero-difference scenario, and only the missing /Scale/ meaning fails the case. The README already documents this as a proposed follow-up and does not apply it to these grades, which matches the intent's rule against automatic grade changes.",
      "action": "no-op",
      "review_scope": "source"
    }
  ],
  "summary": "",
  "risk_level": "medium",
  "risk_rationale": "The change stays in scope: evals/ plus append-only docs with a byte-identical prefix, no src/agent or config changes, and digest-pinned recordings with exact-verdict replay. However, the committed verdicts pin a grader false positive for an echoed user period, and the results README says no known false positive remains, so docs and grader should be reconciled before the PR claims are published.",
  "risk_scope": "source-or-external"
}
```
