Fix plan-regex-throws inside UI-owned files. Ordinary invoice questions containing problem, approve, provide, process, prorated or explanation must not throw or trigger plan simulation without an actual catalog plan request. Preserve the seeded-plan simulation for 'What would I pay on Pro?'. Add a regression test, watch it fail before the fix, then pass after the fix. Keep all existing tests and schemas. No engine, contracts, frozen dependencies/config, deployment or merge changes. Log the regression test output and updated suite/collection counts in tests/ui/evidence and its README as appropriate. Ensure only truthful count claims.

Record these exact fix instructions by tool-copy into prompt-history/prompts/04i-ui-seed-review-fix-r1.md and append verbatim in PROMPTS.md as automated cross-review, no-mistakes v1.41.2 (Claude), run 01M3R4YFDC2775KN88HGKXBJDV. Append a one-line reason in docs/DECISIONS.md ending 'Decided by: Frontend engineer under standing orders'. Preserve earlier gate-fix commits.

Log round 1 review provenance in prompt-history/prompts/04j-ui-seed-review-r1.md and PROMPTS.md. Say the complete generated review prompt is unavailable in step logs, while the supplied intent is logged separately in 04h-ui-seed-gate-intent.md. Capture these observed lines verbatim:
step: review
run: "01M3R4YFDC2775KN88HGKXBJDV"
lines: 6 total
log[6]{line}:
reviewing changes...
""
claude started pid=134378
""
Reviewing the fixture backend against the engine; now checking the storage namespace migration and messages.Found one chat regression; checking decisions log and evidence tests next.
claude exited pid=134378 status=success

Ensure the isolated checkout has the unchanged pinned dependencies installed with npm ci before tests (the prior UI gate initially lacked vitest). Run npm run typecheck and npm test, plus env -i PATH="$PATH" HOME="$(mktemp -d)" CI=1 npm test. No lockfile hand edits. Update evidence command logs after the routing fix, scrub all home/temp paths, trim trailing whitespace, and keep evidence outside public assets. The completed kickoff/follow-up outcomes must state actual work and checks, without claiming merge/deployment. Re-review the full updated diff for round 2.
