import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 1000 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
});
page.on("console", (msg) => console.log("CONSOLE:", msg.type(), msg.text()));
page.on("requestfailed", (req) =>
  console.log("REQFAIL:", req.method(), req.url(), req.failure()?.errorText),
);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(3000);

const testPhone = page.getByText("Use test phone number", { exact: true });
if (await testPhone.count()) {
  await testPhone.first().click();
  await page.waitForTimeout(800);
}
const email = page.locator('input[name="emailAddress"]');
if ((await email.count()) && (await email.isEnabled())) {
  await email.fill("royalmarket-e2e@mailinator.com");
}
const submit = page.locator('a[behavior="submit"]');
if ((await submit.count()) && (await submit.first().isVisible())) {
  await page.evaluate(() => {
    const anchor = document.querySelector('a[behavior="submit"]');
    anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const form = anchor?.closest("form");
    if (form) form.requestSubmit();
    const hidden = document.querySelector('input[data-testid="hidden-submit"]');
    if (hidden instanceof HTMLInputElement) hidden.click();
  });
} else {
  await page.locator('input[type="tel"]').press("Enter");
}
await page.waitForTimeout(8000);

console.log("URL:", page.url());
console.log("TEXT:\n" + (await page.locator("body").innerText()).slice(0, 10000));
console.log("INPUTS:", await page.locator("input").evaluateAll((els) =>
  els.map((el) => ({
    name: el.getAttribute("name"),
    type: el.getAttribute("type"),
    placeholder: el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute("aria-label"),
    value: el.getAttribute("value"),
    required: el.required,
  })),
));
console.log("SELECTS:", await page.locator("select").evaluateAll((els) =>
  els.map((el) => ({
    name: el.getAttribute("name"),
    ariaLabel: el.getAttribute("aria-label"),
    value: el.value,
    options: [...el.options].map((o) => o.text),
  })),
));
console.log("BUTTONS:", await page.locator("button").evaluateAll((els) =>
  els.map((el) => ({
    text: el.innerText,
    type: el.getAttribute("type"),
    name: el.getAttribute("name"),
    ariaLabel: el.getAttribute("aria-label"),
    disabled: el.disabled,
  })),
));
await page.screenshot({ path: ".e2e/onboard-step.png", fullPage: true });
await browser.close();
