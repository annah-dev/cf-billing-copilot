# Live UI recheck: credit confirmation (2026-10-01)

Real chat UI (`VITE_BILLING_API_MODE=live`) against this branch's local dev, real Llama 3.3,
driven by `ui-recheck.mjs` (headless Chromium; set `UI_PLAYWRIGHT_MODULE` to a Playwright
install). The UI created a fresh sandbox, sent one credit claim and pressed "Confirm request".

- The confirmation showed the real September invoice id (`1-confirmation.png`); no confirmation
  for an invented id appeared.
- After the click the client sent only `cf_agent_tool_approval` (autoContinue), and no second
  chat request (`ui-log.txt`: one `cf_agent_use_chat_request` in the whole session).
- The stream finished, the answer gave the request, $412.87 and "pending approval", and no
  "internal error" or "Unable to connect" appeared (`2-after.png`).

Before the fix, the same flow in local dev (not kept: the scratch directory was lost in a WSL
restart) showed a confirmation for `inv_123456789`, a failed tool call after confirming, a second
confirmation, and a UI stuck on "Checking billing records..." after the client sent both the
approval frame and a full chat request. That sequence is described in docs/DECISIONS.md.

Model calls: 4 for this recheck, one per streamed step in `ui-log.txt` (getInvoice and the
proposal before the confirmation; the status lookup and the answer after; detectAnomalies is
run by the server, not the model). The dev log shows no grounding retry.
