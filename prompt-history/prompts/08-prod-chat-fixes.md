Merged #7. Rebase #8 onto main and force-push feat/agent-fixes (never main). A1: the daily limit
reset at 00:00 UTC, so run the two unreached questions once now. B1: no contract change. On
"first": the evals lane will change the grader so ordinal words are not figures; once that
merges, make the guard follow the same rule.

Then, on a NEW branch and PR after #8 merges (keep #8 as reviewed), fix what the release lane
found against production:
1. In the chat UI, the stream after the customer confirms a credit request fails with "An internal
   error occurred" and the UI shows "Unable to connect". Log the raw error in toolErrorText,
   reproduce it (local dev with VITE_BILLING_API_MODE=live, or wrangler tail against production),
   and fix the cause.
2. Never show the customer a confirmation for an invoice the server has not validated. The model
   called startCreditRequest with an invented inv_1234567890 before any lookup. Resolve or
   validate the invoice server-side before the confirmation appears.
3. Chat messages over the WebSocket are not counted by the rate limiter or the daily caps, which
   contradicts D-7. Count them exactly like /turn.
4. Confirm tool inputs are schema-validated (by the SDK or inside the tool), and fix the D-14 and
   model-settings drift in docs/DECISIONS.md.
Same review loop, live checks under 20 model calls, then open the PR.
