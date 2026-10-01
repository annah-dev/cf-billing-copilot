<pasted_content id="62fd">
Pointers from the release lane for your second PR (hints, not decisions; verify them):
- Error after confirming a credit: the raw error is masked by toolErrorText; log it in the
  onError handlers in src/agent/billing-agent.ts, reproduce, then fix the cause.
- Invented invoice id: validate the invoice before the confirmation is shown, or take a period and
  look the id up server-side; add a prompt rule to look up the invoice before startCreditRequest.
- Uncounted WebSocket writes: the client's cf_agent_chat_messages frames reach storage without
  passing the message cap; check the cap before the SDK saves anything.
</pasted_content id="62fd">
