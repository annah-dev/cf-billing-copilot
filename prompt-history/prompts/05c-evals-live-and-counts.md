PR #4 has merged. Rebase onto main, then record the live model outputs for the eval set.
One addition: make the grounding check cover every number in an answer, including counts. In
the agent's live run the model said "7 lines" for a 6-line invoice; include a question that
would catch that.
