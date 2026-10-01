C1 A1 B1, with changes.

C1: I merged #13. Merge origin/main into feat/release (merge, not rebase). Keep both sides of the PROMPTS.md and DECISIONS.md conflicts, with #13's entries once. Push and tell me when CI is green on #14.

After I merge #14, open one follow-up PR from a fresh origin/main covering A, B and the diagram, with the usual three-round Codex review:

A1: after the customer confirms a credit, refresh the panel on a short bounded schedule (at most 5 reads) until the request leaves "requested". Keep the focus refresh. Remove the manual Refresh from README demo steps 4 and 5 and from the release checklist.

B1, but pass { idempotent: false }, not true. Reason: the SDK's idempotent mode matches callback and payload and ignores the time. When idleSweep runs from the alarm, its own row still exists until the callback returns, so an idempotent re-arm would return that row and the sandbox would never be swept again. armIdleSweep already keeps exactly one pending row; false only silences the warning. Add a test that fires the sweep through the alarm path with recent activity and checks that one future idleSweep remains.

Diagram: copy cf-billing-copilot-architecture.excalidraw and cf-billing-copilot-architecture.svg from my Windows Downloads folder into docs/ as architecture.excalidraw and architecture.svg (chmod 644). Embed the SVG in the README Architecture section and at the top of docs/ARCHITECTURE.md, keeping the Mermaid. Note that the source opens at excalidraw.com. Check every label against the code and list anything wrong rather than editing the SVG. Log it in PROMPTS.md as drawn with Claude (Cowork); my prompt was "I'd like to include an architecture diagram built in excalidraw for the project. Build it for me".

End the PR with one final transcript export so the prompt history covers this work too.
