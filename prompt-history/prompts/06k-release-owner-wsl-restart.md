WSL restarted while you were working, so every process you started is gone: dev servers,
background terminals and any no-mistakes run in progress. Before continuing, check git status and
your branch against origin, redo any step that was cut off, and check any gate run with the
recovery steps in docs/agent/no-mistakes.md rather than restarting the daemon with --force. If
your open PR conflicts with main, merge main into your branch and keep both sides of
docs/DECISIONS.md. Then report where you are.
