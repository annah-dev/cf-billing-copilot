Codes: A1 B1 C1 D1 E2 F1 G1 H2

Why the two overrides: E2 because per-browser sandboxes already isolate state, so a new sandbox is
a clean reset without workflow termination and epoch fencing to build and test. H2 because about
35 turns a day for everyone combined means a reviewer can find the demo out of budget; Workers
Paid with a 50,000-neuron daily stop costs at most about $0.44 a day over the included allowance.

Fold into PR #1:
- B1: in D-2, drop "tested with Llama 3.3 tool calling"; the starter defaults to Kimi, so that is
  unverified until the Stop 2 round trip. Add that the approval API (waitForApproval,
  approveWorkflow, rejectWorkflow, WorkflowRejectedError) is the same in agents 0.17.4 and 0.24.0.
  Every lane prompt must say: when web docs and the installed type definitions disagree, the
  installed types win.
- E2: reset creates a new sandbox and abandons the old one; the 7-day idle alarm cleans it up.
- G1: also add a global cap on new sandboxes per UTC day in Quota, sized from the seed's
  row-write count, and state that count in ARCHITECTURE.md.
- H2: I have upgraded the account to Workers Paid. Set the global model stop to 50,000 estimated
  neurons per UTC day and keep the per-sandbox caps. Update D-8, D-11 and the budget numbers in
  ARCHITECTURE.md. Workflow retention is now 30 days; keep the ledger as the source of truth.

Standing orders from here on. Put them in AGENTS.md under "Decision rights" so every lane
inherits them, and put the review loop in every lane prompt.

1. Cross-review runs without me. The author of a PR gets the other harness's review:
   - Claude-authored PRs: run Codex headless in its default read-only sandbox against the local
     branch diff (git diff origin/main...HEAD), for example:
       codex exec -c model_reasoning_effort=high -o <review-output-file> "$(cat <review-prompt-file>)"
   - Codex-authored PRs: gated push through no-mistakes; the lane agent reads parked review
     findings itself (see ~/projects/job-search-automation/docs/agent/no-mistakes.md), fixes
     them and pushes again.
   Convergence: two full rounds, a third on the delta only, then stop. Anything still disputed
   comes to me as a FOR ANNA list with both positions. Every review prompt is a file under
   prompt-history/prompts/ and is logged in PROMPTS.md with role "automated cross-review".
2. Agents decide, with a one-line reason in DECISIONS.md: implementation choices inside the
   approved architecture, test design, layout inside a lane's own directories, fixes for review
   findings, and taking the [REC] option on any reversible, in-repo question not listed in 3.
3. I decide, batched into one message with a recommendation each: money or account changes,
   scope changes against the assignment, contract changes after the freeze, the security and auth
   model, anything irreversible (deletes, force-push, history rewrite), README claims about me or
   about results, and merges. While waiting, keep working on anything the question does not block.
4. Every entry in DECISIONS.md says "Decided by: Anna" or "Decided by: <role> under standing
   orders".
5. At the top of PROMPTS.md, note that planning and decision review also happened in a separate
   Claude (Cowork) conversation, where the kickoff prompt was drafted.

Now run the Codex review of PR #1 yourself, fold in its findings and my notes, and tell me when
the PR is ready to merge.
