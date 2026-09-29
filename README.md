# cf-billing-copilot

AI-powered billing copilot that runs entirely on Cloudflare. The full README (pitch, architecture,
demo script, setup, evals, limitations) arrives with the release lane; the design is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the decisions in [docs/DECISIONS.md](docs/DECISIONS.md).

## Cost and abuse controls

The public demo runs on the Workers Paid plan with these controls (docs/DECISIONS.md D-7, D-8, D-13):

- **Model budget.** Model calls stop for the day at an estimated 50,000 Workers AI neurons per UTC
  day, reserved before each call. That is at most about $0.44 a day above the included allowance.
- **Caps.** Per sandbox per UTC day: 30 chat messages of up to 2,000 characters, 5 credit requests
  and 200 API requests. Per IP: 5 new sandboxes a day. Globally: 200 new sandboxes a day.
- **Estimated, not hard-bounded.** The caps bound abuse cost at an estimated figure (about $34 a
  month above the $5 plan with every cap saturated all month), not a hard ceiling. A request
  refused by a cap still costs one Durable Object request.
- **Rate limiter.** A per-IP limit of 60 requests a minute to the API and agent routes runs before any Durable
  Object is called (Workers Rate Limiting binding). It is per Cloudflare location and approximate
  by design: a brake, not an accounting system.
- **Budget alert.** A $10 budget alert is set on the Cloudflare account. It only sends email; it
  does not stop anything.
- **Off switch.** Disable the Worker's workers.dev route in the Cloudflare dashboard (the Worker's
  domains and routes settings). The demo goes offline without deleting any data; enabling the
  route again restores it.
