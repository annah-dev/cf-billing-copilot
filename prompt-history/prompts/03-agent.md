# 03 - Agent lane kickoff

Role: Agent/Workflow engineer. Harness: Claude Code. You work alone in this worktree
(~/projects/wt/cf-billing-copilot-agent, branch feat/agent, cut from main after the Stop 2
foundation merged). You see this prompt, the assignment and the repo; nothing else.

## Read first, in this order

1. prompt-history/prompts/00-assignment.md: product scope and the non-negotiable principles.
2. AGENTS.md: the rules, including Decision rights. They bind you.
3. docs/agent/plan.md, section "agent": what you own, what you build, your definition of done, and
   the Stop 2 findings you must build on.
4. docs/agent/verification.md and docs/agent/cross-review.md.
5. docs/ARCHITECTURE.md (flows, Ledger invariants, recovery, admission, budgets) and
   docs/DECISIONS.md (especially D-1, D-4 to D-7, D-9, D-12 to D-15, D-18, DEV-8, DEV-9, DEV-15,
   DEV-16).
6. src/contracts/: the frozen shapes for tools, HTTP, credit requests, audit and config.

At session start, append this prompt to PROMPTS.md by copying this file with a tool (not by
retyping), with an ISO-8601 timestamp with offset, role, harness "Claude Code", source path and
outcome "(pending)". Fill in the outcome at the end.

## Scope

You own `src/server.ts`, `src/agent/`, `src/ledger/`, `src/workflows/`, `src/http/`, `src/quota/`
and `tests/agent/` (not its tsconfig.json), plus the append-only files. You read `src/engine/`
but never edit it. Replace the foundation stubs; keep `tests/agent/foundation.test.ts` passing.

Build what docs/agent/plan.md "agent / Builds" lists: `BillingAgent` with the 8 typed tools on
`MODEL_ID`, history trimming and memory; the `Ledger` with its schema, seeding from `engine.seed()`,
state machine, invariants, audit log, single-alarm `timers` queue and idle deletion; the
`CreditRequestWorkflow` (validate, pending memo, `step.waitForEvent` with an explicit timeout,
decision from the Ledger, apply or reject, expire); `Quota` (sandbox caps and the neuron
reservation); every HTTP endpoint in src/contracts/http.ts with admission, the approver token check
(constant-time hash comparison) and the caps; the per-IP `RATE_LIMITER` before any Durable Object
call.

Stop 2 facts you build on, measured in local dev:

- Native streaming with tools garbles Llama 3.3's tool arguments on these package versions. Wrap
  the model: `wrapLanguageModel({ model: workersai(MODEL_ID), middleware:
  simulateStreamingMiddleware() })` (D-14). It worked end to end in the round trip.
- The model converted cents to dollars itself when given raw cents. Tools return contract outputs
  whose amounts are `Money` (D-15); the system prompt tells the model to copy `display` strings.
- The model repeated an identical `getAccount` call before answering. Serve identical calls within
  a turn from a per-turn cache and keep the step limit small.
- One tool round trip cost about 945 input and 69 output tokens (about 40 neurons).
- `routeAgentRequest` maps every Durable Object binding by name; only `/agents/billing-agent/` may
  reach it (the foundation test enforces this).

The Workers AI binding is always remote. Tests stub it; they never reach the model.

## Definition of done

As in docs/agent/plan.md "agent / Done", every listed test present and able to fail (plant at
least the double-credit and decision-race defects and show them going red). Evidence also includes
one local-dev chat turn against real Llama 3.3 (a handful of calls, never a loop; a readiness probe
must hit a path that does not call the model) with its tool calls and token usage, and the credit
flow driven by curl in local dev with the transcript. Report every live model call you made.

## Rules that are easy to miss

- When web docs and the installed type definitions disagree, the installed types win; record the
  disagreement in docs/DECISIONS.md.
- Contracts and wrangler.jsonc are frozen. If one is wrong, stop, explain, and wait: the fix is its
  own PR to main.
- Decide implementation details yourself; record each non-obvious one at the end of
  docs/DECISIONS.md headed `## agent: <decision>`, with a one-line reason and "Decided by: Agent
  engineer under standing orders". Owner questions (AGENTS.md, Decision rights item 3; the security
  and auth model is one) go in one batched message with a recommendation each; keep working on
  anything they do not block.
- Plain ASCII in docs and comments. Small conventional commits, no co-author footers.

## Review loop and finishing

1. Rebase on origin/main (after the engine lane merges, rebase onto it), run the done-contract
   commands, push `feat/agent` to origin and open the PR with the evidence from
   docs/agent/verification.md, ending with VERIFIED and NOT VERIFIED lines.
2. Codex reviews it headless (docs/agent/cross-review.md): write the review prompt to
   `prompt-history/prompts/03b-agent-review-r1.md` (then `03c-...-r2`, `03d-...-r3`), log it in
   PROMPTS.md with role "automated cross-review", and run
   `codex exec -c model_reasoning_effort=high -o <scratch>/review-r1.md "$(cat <prompt-file>)"`.
3. Fix or rebut each finding, push, post the round summary on the PR. Two full rounds, a third on
   the delta only, then stop. Anything still disputed goes to the owner as a FOR ANNA list with
   both positions.
4. Never merge; the owner merges.
