# UI lane evidence

Shared-engine preview captured from the actual `npm run dev` app at 1440 x 1000 and 390 x 1000.
Full-page screenshots retain content beyond the initial viewport; the panel images crop the panel
within each layout. Customers, meters, issued invoice values, balance, comparison, simulation,
anomalies, historical credits and audit records come from `engine.seed()` and engine functions.
The banner identifies the preview. No model or live HTTP call is made.

| State                              | Desktop layout                        | 390 px layout                        |
| ---------------------------------- | ------------------------------------- | ------------------------------------ |
| Chat and invoice tool evidence     | [chat](chat-1440.png)                 | [chat](chat-390.png)                 |
| Invoice, credits, audit panel      | [panel](panel-1440.png)               | [panel](panel-390.png)               |
| Customer credit confirmation       | [confirmation](confirmation-1440.png) | [confirmation](confirmation-390.png) |
| Admin pending review               | [admin](admin-1440.png)               | [admin](admin-390.png)               |
| Daily cap with limit and UTC reset | [cap](cap-1440.png)                   | [cap](cap-390.png)                   |

Start the existing dev server without remote bindings:

```sh
XDG_CONFIG_HOME="$(mktemp -d)" CLOUDFLARE_VITE_FORCE_LOCAL=true WRANGLER_SEND_METRICS=false npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Run the browser script with an existing external Playwright installation (no repo dependency or
config changes). `UI_PLAYWRIGHT_MODULE` is its module path; if it is already resolvable, omit it.

```sh
UI_PLAYWRIGHT_MODULE=/path/to/@playwright/test/index.mjs node tests/ui/browser-evidence.mjs
```

[browser-checks.txt](browser-checks.txt) records the exercised interactions. At both widths the
script imports the shared engine in the browser and compares customer options, every invoice line,
invoice total and balance directly with engine outputs. It also exercises confirm and cancel,
required decision reason, approve and reject across tabs, refreshed audit and status, chat reload,
customer isolation, sandbox reset, fragment removal, storage refusal and horizontal overflow.
No browser exception or `/api/` or `/agents/` request occurred. Screenshots were visually inspected
for readable seeded names, meters, confirmation actions, historical audit and mobile layout.

The automated suite has 146 passing tests: 113 on main after the engine merge plus 33 UI tests.
Collection comparison in [test-collection.txt](test-collection.txt) reports no removed tests.
New tests compare every customer's fixture invoice, plan, balance, credits and historical audit
with the seed; comparison, simulation and anomaly tool outputs with engine results; and credit
validation and the approved balance with engine results while preserving the issued invoice.
They also prove unsupported duplicate claims use the engine refusal and old preview sessions are
ignored. Existing tests retain schema validation, identity checks, bearer headers, decision
validation, error states, reset and customer isolation, storage failure, and display copying.

Replacing seeded customer names with `Nimbus Studio` deliberately made `derives every customer's
plan, invoice, balance, history and customers from the shared seed` fail. Restoring the engine
mapping made it pass. [ui-planted-defect.txt](ui-planted-defect.txt) and
[ui-defect-restored.txt](ui-defect-restored.txt) record the failure and restoration.

Gate review round 1 found that loose chat routing sent ordinary questions such as "Is there a
problem with my invoice?" to plan simulation. The regression test `answers ordinary invoice
questions without simulating an unnamed plan` failed before the fix
([ui-plan-routing-regression-fail.txt](ui-plan-routing-regression-fail.txt)) and passed after it
([ui-plan-routing-regression-pass.txt](ui-plan-routing-regression-pass.txt)). The full and
credential-free logs were rerun after the fix. Screenshots and browser checks predate this
routing fix; the chat suggestions they exercise route to the same tools before and after.

[amount-grep.txt](amount-grep.txt) contains the review grep over the UI lane. Monetary outputs are
engine results, validated credit memo copies, or contract `.display` references. There is no UI
amount arithmetic, conversion, rounding or formatting. Nonmonetary arithmetic increments response
generations or audit sequences, advances an approval deadline, orders statuses or serializes IDs.

Live model calls: none (0). The real HTTP endpoints, deployed UI, live WebSocket stream and live
AI SDK approval continuation are not exercised because the agent lane has not merged. The
preview applies human decisions immediately; it does not prove the real Workflow runs. With
browser storage blocked, preview remains usable in one tab; a second preview admin tab requires
storage. Live admin links carry credentials independently of localStorage. Production bundle
compilation passes with Vite's existing warning for a client chunk over 500 kB; no deployed bundle
or performance measurement is claimed.

VERIFIED: offline checks, credential-free suite, production compilation, engine parity tests,
preview browser flows, desktop and 390 px screenshots, no amount arithmetic, no model calls.
NOT VERIFIED: live API, live agent streaming and approval continuation, deployed UI, real Workflow,
production performance and additional browsers; agent lane is pending and evidence uses Chromium.
