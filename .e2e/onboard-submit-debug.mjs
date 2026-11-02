import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(3000);
await page.getByText("Use test phone number", { exact: true }).click();
await page.waitForTimeout(1200);

const found = page.locator("text=Submit");
console.log("text count:", await found.count());
for (let i = 0; i < (await found.count()); i++) {
  console.log(`[${i}]`, await found.nth(i).evaluate((el) => ({
    tag: el.tagName,
    outer: el.outerHTML.slice(0, 2000),
    parent: el.parentElement?.outerHTML.slice(0, 2000),
    box: el.getBoundingClientRect().toJSON(),
  })));
}
console.log("submit-ish:", await page.locator('[data-testid*="submit" i], [class*="submit" i]').evaluateAll((els) =>
  els.slice(0, 20).map((el) => el.outerHTML.slice(0, 1500)),
));
await page.screenshot({ path: ".e2e/onboard-submit-debug.png", fullPage: true });
await browser.close();
