// Run manually with the existing external Playwright installation; never collected by vitest.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.UI_PLAYWRIGHT_MODULE || "@playwright/test"
);
const origin = process.env.UI_EVIDENCE_ORIGIN || "http://127.0.0.1:5174";
const folder = new URL("./evidence/", import.meta.url).pathname;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 }
    });
    const page = await context.newPage();
    context.on("page", (tab) =>
      tab.on("pageerror", (e) => failures.push(e.message))
    );
    page.on("pageerror", (e) => failures.push(e.message));
    // Fixtures must never connect to an agent or API or call a model.
    context.on("request", (request) => {
      if (/\/api\/|\/agents\//.test(new URL(request.url()).pathname))
        failures.push(`Unexpected request: ${new URL(request.url()).pathname}`);
    });
    async function capture(name, locator) {
      await page.evaluate(() => document.fonts.ready);
      if (locator)
        await locator.screenshot({ path: `${folder}${name}-${width}.png` });
      else
        await page.screenshot({
          path: `${folder}${name}-${width}.png`,
          fullPage: true
        });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false,
        `${name} overflow at ${width}`
      );
    }
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Understand every charge." })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Explain my September invoice",
        exact: true
      })
      .click();
    await page.getByText("Source verified", { exact: true }).waitFor();
    await capture("chat");
    await capture(
      "panel",
      page.getByRole("complementary", { name: "Invoice and audit panel" })
    );
    await page
      .getByRole("button", {
        name: "I was double-charged. Can I request a credit?",
        exact: true
      })
      .click();
    await page.getByRole("heading", { name: "Request a credit?" }).waitFor();
    await page
      .getByRole("heading", { name: "Request a credit?" })
      .scrollIntoViewIfNeeded();
    await capture("confirmation");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByText("Cancelled", { exact: true }).count(), 1);
    assert.equal(await page.locator(".status-pending_approval").count(), 0);
    await page
      .getByRole("button", {
        name: "I was double-charged. Can I request a credit?",
        exact: true
      })
      .click();
    await page
      .getByRole("button", { name: "Confirm request", exact: true })
      .click();
    await page.locator(".status-pending_approval").waitFor();
    await page.reload();
    await page.locator(".status-pending_approval").waitFor();
    assert.equal(
      await page.getByText("Source verified", { exact: true }).count(),
      2
    );
    await page
      .getByLabel("Customer", { exact: true })
      .selectOption("cus_orbit");
    await page
      .locator(".invoice-card")
      .getByText(/Orbit Workshop/)
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".status-pending_approval")
    );
    assert.equal(await page.locator(".message").count(), 0);
    await page
      .getByLabel("Customer", { exact: true })
      .selectOption("cus_nimbus");
    await page.locator(".status-pending_approval").waitFor();
    const [admin] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Approver view" }).click()
    ]);
    await admin.getByRole("heading", { name: "Credit review" }).waitFor();
    await admin.locator(".status-pending_approval").waitFor();
    assert.equal(new URL(admin.url()).search, "");
    assert.equal(new URL(admin.url()).hash, "");
    const card = admin
      .locator(".admin-card")
      .filter({ has: admin.locator(".status-pending_approval") });
    assert.equal(
      await card.getByRole("button", { name: "Approve credit" }).isDisabled(),
      true
    );
    await card
      .getByLabel(/Decision reason/)
      .fill("Verified the duplicate billing-run posting.");
    await admin.screenshot({
      path: `${folder}admin-${width}.png`,
      fullPage: true
    });
    assert.equal(
      await admin.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
    await card.getByRole("button", { name: "Approve credit" }).click();
    await admin.locator(".status-applied").waitFor();
    await admin.reload();
    await admin.locator(".status-applied").waitFor();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator(".status-applied").waitFor();
    assert.equal(
      await page.getByText("credit applied", { exact: true }).count(),
      1
    );
    const beforeReset = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("billing-copilot.session.v1.fixture"))
          .sandboxId
    );
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your bill, explained." })
      .waitFor();
    assert.notEqual(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("billing-copilot.session.v1.fixture"))
            .sandboxId
      ),
      beforeReset
    );
    assert.equal(await page.locator(".status-applied").count(), 0);
    await page
      .getByRole("button", {
        name: "I was double-charged. Can I request a credit?",
        exact: true
      })
      .click();
    await page
      .getByRole("button", { name: "Confirm request", exact: true })
      .click();
    await page.locator(".status-pending_approval").waitFor();
    const [rejectAdmin] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Approver view" }).click()
    ]);
    const rejectCard = rejectAdmin
      .locator(".admin-card")
      .filter({ has: rejectAdmin.locator(".status-pending_approval") });
    await rejectCard
      .getByLabel(/Decision reason/)
      .fill("The posting is not eligible for this preview credit.");
    await rejectCard.getByRole("button", { name: "Reject request" }).click();
    await rejectAdmin.locator(".status-rejected").waitFor();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator(".status-rejected").waitFor();
    await page.goto(`${origin}/?preview=cap`);
    await page.getByText("Demo limit reached", { exact: true }).waitFor();
    await capture("cap");
    checks.push(
      `${width}px: invoice evidence, cancellation, confirmation, persistence, customer isolation, fragment cleanup, reason required, approve, reject, audit refresh, sandbox reset, cap state, no overflow.`
    );
    await context.close();
  }
  const blocked = await browser.newContext({
    viewport: { width: 390, height: 1000 }
  });
  await blocked.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      }
    })
  );
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(origin);
  await blockedPage
    .getByRole("heading", { name: "Understand every charge." })
    .waitFor();
  await blockedPage.getByText(/Browser storage is unavailable/).waitFor();
  checks.push(
    "Blocked localStorage: boots successfully and explains persistence limits."
  );
  await blocked.close();
  assert.deepEqual(failures, []);
  checks.push(
    "No browser exceptions; zero /api or /agents requests in fixture mode. No model calls."
  );
  await writeFile(`${folder}browser-checks.txt`, checks.join("\n") + "\n");
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
