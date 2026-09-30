Fix ui-evidence-in-public under the owner's AGENTS.md standing orders, which authorize implementation choices, layout inside this lane's directories, and fixes for review findings. Evidence publication was not a deliberate owner requirement. Preserve all screenshots and validation evidence but move public/ui-evidence to tests/ui/evidence (within UI lane ownership, not docs/). Update tests/ui/browser-evidence.mjs's output folder and evidence references in the moved README. Scrub all absolute home paths and temporary credentials-directory paths in the evidence logs. Do not edit frozen files, dependencies, lock files, server, engine or other lane files. Rate-limit copy is currently accurate and its finding is informational, so no config change is needed.

Record this evidence-placement correction in a new append-only docs/DECISIONS.md entry ending 'Decided by: Frontend engineer under standing orders'. Update only this lane's kickoff outcome in PROMPTS.md to record the implemented fixture UI, checks and evidence relocation, with gate/PR completion still pending. Add this exact fix instruction text as prompt-history/prompts/04b-ui-gate-fix-r1.md and log it in PROMPTS.md as an automated cross-review instruction, harness no-mistakes v1.41.2 (Claude), run id 01M3QZB8FZYYY4NW9MSAM1FZ6Y.

The gate's full review log exposed no review prompt text. Save the observed log verbatim in prompt-history/prompts/04g-ui-gate-review-r1.md, preceded by a statement that the prompt text was not available and version v1.41.2 was reported by the CLI. The observed log was:
step: review
run: "01M3QZB8FZYYY4NW9MSAM1FZ6Y"
lines: 6 total
log[6]{line}:
reviewing changes...
""
claude started pid=88156
""
"Reviewing the UI diff now; checking whether the evidence files under `public/` would be deployed, then finishing up."
claude exited pid=88156 status=success
Log the unavailable prompt in PROMPTS.md with role automated cross-review, harness no-mistakes v1.41.2 (Claude), run id and source file. Do not claim the original gate prompt was captured. Do not deploy or merge. Keep the automatic review-fix commit so the local branch can be synchronized safely afterward.
