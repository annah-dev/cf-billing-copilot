A1: I merged contract PR #6. Rebase PR #4 onto main now. Rebasing your own feature branch with
--force-with-lease is fine; never force-push main.

Before marking PR #4 ready, fix the anomaly gap you found. User story 4 says the copilot mentions
the September 18 spike proactively, and today that depends on Llama 3.3 choosing to call
detectAnomalies, which it did not do in the live run. Make it deterministic: when a turn fetches
or explains an invoice, the server runs detectAnomalies for that period itself and gives the
result to the model as a server-issued tool call and result (the tool exists, so no contract
change). Add a test that fails if the mention depends on the model's choice, and re-run the live
September chat turn to show it.

B: then run one final delta-only Codex review covering the two round-4 commits and the anomaly
change together, fix what it finds, and mark PR #4 ready.
