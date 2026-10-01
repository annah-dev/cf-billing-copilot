#12 (production fixes) and #10 are merged, and I have redeployed main. Start phase 2. Additions:
- First recheck the credit flow through the UI on the live site (the confirmation shows the real
  invoice id, no error after confirming, credit applied, audit visible), with wrangler tail
  running; record any "internal error ... reference" lines you see.
- The credential-free test run times out intermittently under load. Reviewers will run npm test,
  so make it reliable (a suite timeout or less parallelism) without weakening any assertion.
- Keep the top of the README scannable in 30 seconds (pitch, demo link, 5-step demo script), and
  add a short "How this was built" section linking five moments where I made a call: D-20
  confirmation on /turn, the debit vs card-payment correction, npm test checking the harness not
  the model, the deterministic anomaly check, and the per-IP cap change.
- I may rename the repository to start with cf_ai_ before submitting; keep repository links in one
  place in the README.
