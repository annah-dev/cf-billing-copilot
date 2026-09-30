It is not deployed yet; the deploy happens in the release lane after the ui PR merges. Yes, use
local dev with real Workers AI for now: record the replay fixtures and a first pass rate from it.
Make the base URL a parameter (for example EVAL_BASE_URL, defaulting to local dev), and write the
base URL, date and model call count into every results file. Label this run "local dev". The
pass rate in the README will come from a rerun against
https://cf-billing-copilot.anna-hester.workers.dev after deploy, done by the release lane.
Budget: one full run, then reruns of failing questions only, no loops; report the total model
calls and estimated neurons. If the set needs more messages than one sandbox's daily cap, spread
the questions across sandboxes rather than raising the cap.
