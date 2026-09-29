# 01 - Architect kickoff

Role: Architect. Harness: Claude Code. Session 1 of the build.
Drafted with Claude (Cowork) from the assignment and my environment conventions; reviewed and sent by me.

The assignment is prompt-history/prompts/00-assignment.md. Read all of it first. It governs product
scope, design principles and acceptance criteria. This file governs how the build runs. Where the two
conflict on process, this file wins. Flag any other conflict to me instead of resolving it silently.

## How this build runs

- Parallel lanes, one agent session per lane, each in its own git worktree that I create. You do not
  create worktrees, start other agents, or write outside your worktree.
- Authoring and review are split across harnesses. Codex CLI authors the lanes that implement a
  written contract; Claude Code takes the Agent/Workflow lane. Every PR is reviewed by the harness
  that did not write it: Codex-authored PRs go through the no-mistakes gate (Claude reviews),
  Claude-authored PRs get a Codex review.
- Codex runs with low reasoning effort by default on this machine. Every Codex launch command you
  write (lanes and reviews) passes `-c model_reasoning_effort=high`.
- I merge every PR (squash). No agent runs `gh pr merge`, `wrangler deploy`, `wrangler secret put`
  or `wrangler login`. When one of those is needed, give me the exact command and stop.
- Each stop below ends with a PR from a fresh branch off origin/main. After I merge, start the next
  branch from a fresh origin/main (squash merges leave the old branch unusable).

## Stop 1: plan (docs only, no code)

1. Read the current Cloudflare docs before deciding anything: the Agents SDK
   (https://agents.cloudflare.com/, https://developers.cloudflare.com/agents/), Workers AI (the
   Llama 3.3 model page, function calling), Durable Objects (SQLite storage), Workflows
   (step.waitForEvent, sending an event to an instance, Free-plan limits), and
   https://github.com/cloudflare/agents-starter as it is today. Record the versions, model ID and API
   names you actually found.
2. Write docs/ARCHITECTURE.md (with a Mermaid diagram) and docs/DECISIONS.md. DECISIONS.md opens
   with every point where the assignment differs from the current docs, then the ledger store choice
   (Durable Object SQLite vs D1) with its reasoning.
3. Write docs/agent/plan.md: the lanes below, the directories each lane owns, what each lane must not
   touch, merge order, a definition of done per lane, and the exact command I run to start each lane
   and each cross-review.
4. Propose an answer, with a recommendation, for each of these:
   - how a reviewer approves a credit in the public demo without a secret in the repo;
   - how a reviewer resets the demo to the seeded story after someone has applied a credit;
   - what happens when an approval never arrives (waitForEvent timeout, Free-plan Workflow state
     retention). Expiry must be an explicit terminal state with its own audit record;
   - abuse of the public chat URL (a simple per-session or per-IP message cap).
5. Open the PR and stop. Report what you read (with links), the deviations from the assignment, and
   the decisions you need from me.

Lanes for the plan (adjust directories to the scaffold's layout):

- engine (Codex): billing engine, seed data, unit tests. Pure TypeScript, no Cloudflare imports.
- agent (Claude Code): chat agent Durable Object, tool wiring to Llama 3.3, CreditRequestWorkflow,
  and the HTTP endpoints the UI and admin page call.
- ui (Codex): chat page, invoice / credit requests / audit side panel, /admin approvals view.
- evals (Codex, after engine and agent merge): scripted eval set and harness.
- release (Claude Code, last): Reviewer pass over the whole repo, README, deploy checklist,
  prompt-history export.

## Stop 2: foundation on main (after I approve Stop 1)

6. Scaffold from agents-starter with create-cloudflare pinned to an exact version (resolve it; never
   run @latest) and with `--no-deploy --no-git`, since C3 deploys by default. The repo already has
   README.md and .gitignore, so scaffold into a scratch directory outside the repo and copy in. Merge
   the two .gitignore files: .dev.vars*, .env* and .wrangler/ must be ignored before any secret
   exists. Record the C3 version and the template commit in docs/DECISIONS.md.
7. Repo rules: AGENTS.md (canonical rules for every agent, pointing to the done-contract), CLAUDE.md
   as a small shim ("Read AGENTS.md"), docs/agent/verification.md (the done-contract: exact commands,
   the evidence each PR must carry, and a rule that every report names what was not verified), an
   MIT LICENSE whose copyright holder is the name in `git config user.name`, and PROMPTS.md.
8. .claude/settings.json with permissions.ask rules for gh pr merge, wrangler deploy, wrangler
   secret, wrangler login and npm run deploy.
9. Contracts, so the lanes can fork: shared types and zod schemas for money (integer cents), plans
   and tiers, usage records, ledger entries, invoices and line items, every tool's input and output,
   credit requests, audit records, and the HTTP request and response shapes the UI and admin page
   use. Also the wrangler config with every binding declared (AI, the agent Durable Object with its
   SQLite migration, the Workflow), so no lane has to edit it. Once this PR merges, contracts are
   frozen: a lane that finds a contract wrong stops, and the fix goes to main as its own PR.
10. `npm test` (vitest) runs and passes, and GitHub Actions runs `npm ci && npm test` on every PR.
11. Quality gate: set up no-mistakes for this repo the same way ~/projects/job-search-automation does
    (read its docs/agent/no-mistakes.md and .no-mistakes.yaml): agent: claude, commands.test:
    npm test, the same auto_fix caps. The config reaches main by plain push first. If
    `systemctl --user` cannot reach the daemon, say so and skip this item. Never restart the daemon
    with --force.
12. De-risk the model before the lanes fork: in local dev, one real round trip in which Llama 3.3
    calls a stub tool (for example getAccount) through the scaffold's provider and answers from the
    result. Report the model ID used and the raw tool call.
13. Write one self-contained kickoff prompt per lane under prompt-history/prompts/ (02-engine.md,
    03-agent.md, 04-ui.md, 05-evals.md, 06-release.md). Each lane agent sees only its file, the
    assignment and the repo, never this conversation.
14. Open the PR and stop. Report what you verified and what you did not.

## Pre-decided (do not ask)

- `npm test` is deterministic and offline. It runs the billing-engine unit tests and the eval harness
  in replay mode against recorded model outputs. The live eval against the deployed URL is a separate
  script, `npm run eval:live`, which re-records; the README reports its pass rate with the run date.
- Workers AI on the Free plan is 10,000 neurons per day, reset at 00:00 UTC, and requests fail past
  that. No live model calls in tests and no loops against the live model. Stay on the Free plan; ask
  me before anything that needs Paid.
- PROMPTS.md lists every prompt given to any agent, in order: ISO-8601 timestamp with offset, role,
  harness, the prompt text, and a one-line outcome. At session start, append your own prompt by
  copying its file with a tool, never by retyping it, and fill in the outcome at the end. Prompts I
  type mid-session are logged too. Near the end, a script exports the raw Claude Code and Codex
  session transcripts for this repo and its worktrees into prompt-history/transcripts/, scrubbed of
  secrets, tokens and home-directory paths, and cross-checks PROMPTS.md against them.
- The assignment prompt is recorded verbatim, including the line naming the role it was written for.
  Nothing else about my career or employers goes in the repo.
- Reviewer-facing docs live where the assignment puts them (README.md, PROMPTS.md,
  docs/ARCHITECTURE.md, docs/DECISIONS.md). docs/agent/ holds only agent-operational files. No
  duplicated content between the two.
- Plain ASCII in docs and code comments: no em dashes, arrows or emoji. Small commits with
  conventional messages and no agent co-author footers.

## Ask me before

Creating any Cloudflare resource beyond what I approved at Stop 1 (D1, KV, R2, queues, anything
billed), upgrading the plan, registering or changing the workers.dev subdomain, changing account
settings, or touching anything outside this repo and my Cloudflare account.
