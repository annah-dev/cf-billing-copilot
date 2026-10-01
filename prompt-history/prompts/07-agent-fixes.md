Role: agent fixes. Harness: Claude Code. Read AGENTS.md, docs/ARCHITECTURE.md and docs/DECISIONS.md first, and log this prompt in PROMPTS.md.

I am away for about five hours. Do not wait on me: take your recommended option on anything within your decision rights and log it. For anything reserved to me (merge, deploy, login, secrets, force-push to main, account changes, contract changes), add it to a FOR ANNA list and keep going with everything it does not block. If wrangler authentication fails, do not try to log in; continue offline and list it.

Context: the evals lane measured the copilot on 15 scripted questions in local dev: 9 of 15 pass. Its harness, recordings and per-question failure analysis are on the unmerged branch feat/evals (worktree ~/projects/wt/cf-billing-copilot-evals, file evals/results/README.md). It is finishing a grader rule I decided: money amounts, percentages and counts must come from the turn's tool results; dates and billing periods may also come from the customer's own message.

Goal: raise the real pass rate by fixing the product, never the grader.
1. Runtime grounding guard: before a reply is sent, check every money amount, percentage and count in it against that turn's tool results, and dates and periods against the tool results or the customer's message, using the same rule as the grader. If something is unsupported, retry once with a correction naming it; if it still fails, send a safe answer without the unsupported figure. Record the guard outcome on the turn. Add tests that go red without the guard. This part needs no harness; start it now on this branch.
2. Once the evals PR is open, rebase onto feat/evals so you can run the harness, then fix the other failures the analysis attributes to the agent or its prompt, one commit per cause. When the evals PR merges, rebase onto main.
3. Do not change evals/ or src/contracts. If a failure is the grader's fault, list it for me.
Measure: rerun only the failing questions live against your local dev, once each, then the full set once. Report pass rate before and after, model calls and neurons. No loops.
Review: Codex headless per AGENTS.md (two full rounds, one delta). Open the PR against main, marked as depending on the evals PR.
