// Live UI recheck for PR B: a fresh sandbox created by the UI, one credit claim, one confirmation.
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "@playwright/test");
const fs = await import("node:fs");
const out = process.argv[2];
const log = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => log.push(`console.${m.type()}: ${m.text()}`));
page.on("websocket", (ws) => {
  ws.on("framesent", (f) => log.push(`WS> ${String(f.payload).slice(0, 3000)}`));
  ws.on("framereceived", (f) => log.push(`WS< ${String(f.payload).slice(0, 3000)}`));
  ws.on("close", () => log.push("WS closed"));
});
const box = 'textarea[placeholder="Ask about your bill..."]';
await page.goto("http://127.0.0.1:5174/");
await page.waitForSelector(box, { timeout: 60000 });
await page.fill(box, "My September 2026 invoice debit was posted twice. Please request a credit for the duplicate.");
await page.click('button[type="submit"]');
let confirmed = false;
try {
  await page.waitForSelector("text=Confirm request", { timeout: 120000 });
  log.push("CONFIRMATION SHOWN: " + (await page.innerText('[aria-label="Credit confirmation"]')).replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/1-confirmation.png`, fullPage: true });
  await page.click("text=Confirm request");
  confirmed = true;
} catch (e) {
  log.push(`NO CONFIRMATION: ${e}`);
}
if (confirmed) {
  try {
    await page.waitForFunction(() => !document.body.innerText.includes("Checking billing records"), null, { timeout: 120000 });
    log.push("STREAM FINISHED");
  } catch (e) {
    log.push(`STILL BUSY: ${e}`);
  }
}
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/2-after.png`, fullPage: true });
const chat = await page.innerText('[aria-label="Billing chat"]');
log.push("CHAT TEXT: " + chat);
log.push("ERROR TEXT PRESENT: " + /internal error|Unable to connect/i.test(await page.innerText("body")));
fs.writeFileSync(`${out}/ui-log.txt`, log.join("\n"));
await browser.close();
