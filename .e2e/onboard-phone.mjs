import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(3000);

const target = page.getByText("Use test phone number", { exact: true });
console.log("test-phone count:", await target.count());
if (await target.count()) {
  await target.first().click();
  await page.waitForTimeout(1500);
}

console.log("URL:", page.url());
console.log("TEXT:\n" + (await page.locator("body").innerText()).slice(0, 8000));
console.log("INPUTS:", await page.locator("input").evaluateAll((els) =>
  els.map((el) => ({
    name: el.getAttribute("name"),
    type: el.getAttribute("type"),
    placeholder: el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute("aria-label"),
    value: el.getAttribute("value"),
  })),
));
await page.screenshot({ path: ".e2e/onboard-phone.png", fullPage: true });
await browser.close();
