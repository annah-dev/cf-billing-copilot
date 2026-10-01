A1 B1. Merging #8 now. You were right about the limit; my note got the UTC day wrong.
Add one item to the second PR: raise the new-sandbox cap per IP from 5 to 20 per UTC day, and keep
the global cap of 200 and the per-sandbox message cap. Reason: several reviewers behind one office
or VPN address would otherwise lock each other out after five sandboxes, and a full eval run needs
about five on its own. Update D-7, the cost estimate in docs/ARCHITECTURE.md and any doc that
states the cap. Run remember-credit as part of that PR's live checks after 00:00 UTC.
