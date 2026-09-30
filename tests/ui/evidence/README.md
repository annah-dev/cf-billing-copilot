# UI lane evidence

Fixture preview captured from the actual `npm run dev` app at 1440 x 1000 and 390 x 1000.
Full-page screenshots retain content beyond the initial viewport; the panel images crop the panel
within each layout. The fixture banner distinguishes illustrative UI values from the engine seed.

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

[browser-checks.txt](browser-checks.txt) records the exercised interactions. They include both
widths, confirm and cancel, required decision reason, approve and reject across tabs, refreshed
audit and status, chat reload, customer isolation, sandbox reset, fragment removal, storage refusal,
and horizontal overflow. No browser exception or `/api/` or `/agents/` request occurred in fixtures.

The review inspected the rendered desktop confirmation and the mobile chat, panel and admin
layouts. It found a clipped confirmation in the desktop chat scroller; the implementation now
scrolls new message content into view, and the browser run and screenshots were repeated after the
fix. The captured layouts have no horizontal overflow at either width.

The automated suite has 68 passing tests: the original 42 plus 26 UI tests. Collection comparison
in [test-collection.txt](test-collection.txt) reports no removed tests. Unit tests cover API schema
validation, identity checks, bearer header transport, decision validation, fragment parsing,
storage failure and mode isolation, every ErrorResponse code, fixture credit lifecycle and reset
isolation, tool schemas, and Money/Percent/Multiple display copying.

A deliberate bypass of response schema validation made `rejects a malformed success payload
instead of rendering it` fail on the invalid Money display fixture. Restoring validation made it
pass. The failure and restoration output tails are attached alongside command validation output.

[amount-grep.txt](amount-grep.txt) contains the review grep over the UI lane. Amounts appear as
literal fixture pairs or contract `.display` references; no UI amount arithmetic, conversion,
rounding or formatting is present. Remaining arithmetic increments response generations or audit
sequence numbers, sorts statuses, or serializes randomly generated identifiers.

Live model calls: none (0). The real HTTP endpoints, deployed UI, live WebSocket stream and live
AI SDK approval continuation are not exercised here because the agent lane has not merged. The
fixture credit decision is immediate and illustrative; it does not prove the real Workflow runs.
With browser storage blocked, the fixture preview remains usable in one tab; fixture admin in a
second tab requires storage. Live admin links carry credentials independently of localStorage.
Production bundle compilation passes, with Vite's existing-size warning for a client chunk over
500 kB; no deployed bundle or performance measurement is claimed.

VERIFIED: offline checks, production compilation, schema and state unit tests, fixture browser
flows, desktop and 390 px screenshots, no amount arithmetic, no model calls.
NOT VERIFIED: live API, live agent streaming and approval continuation, deployed UI, real Workflow,
production performance and additional browsers; agent lane is pending and evidence uses Chromium.
