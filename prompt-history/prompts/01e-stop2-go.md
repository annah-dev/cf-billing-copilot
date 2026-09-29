   A1 B1. PR #1 is merged; start Stop 2.

   Why A1 and not A2: the rate-limit binding is a cheap, platform-native filter in front of the
   Durable Objects. A hard lifetime only bounds storage, which costs cents, so it is not worth
   reopening E2. I have set a $10 budget alert on the account.

   Document in the README and D-13: abuse cost is bounded by caps at an estimated figure, not a
   hard ceiling; the rate limiter is per-location and approximate by design; the budget alert
   only emails; the off switch is disabling the workers.dev route in the dashboard, which
   takes the demo offline without deleting data. Put that off switch in the release checklist.
