import { chromium } from "playwright";

const url = process.argv[2];
if (!url) throw new Error("Pass the Stripe onboarding URL");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(4000);

console.log("URL:", page.url());
console.log("TITLE:", await page.title());
console.log("TEXT:\n" + (await page.locator("body").innerText()).slice(0, 12000));
console.log("INPUTS:", await page.locator("input").evaluateAll((els) =>
  els.map((el) => ({
    name: el.getAttribute("name"),
    type: el.getAttribute("type"),
    placeholder: el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute("aria-label"),
    value: el.getAttribute("value"),
  })),
));
console.log("BUTTONS:", await page.locator("button").evaluateAll((els) =>
  els.map((el) => ({
    text: el.innerText,
    type: el.getAttribute("type"),
    name: el.getAttribute("name"),
    ariaLabel: el.getAttribute("aria-label"),
  })),
));
await page.screenshot({ path: ".e2e/onboard.png", fullPage: true });
await browser.close();
