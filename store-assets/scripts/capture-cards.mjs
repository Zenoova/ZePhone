// Pieces of the real desktop UI that float over the pictures as cards (captures/card-*.png), light and dark: the orb picker and
// the accounts list (popovers of the dock), a contact's card, the incoming-call window. Needs `npm run dev` of the app (port 1420).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(import.meta.dirname, "..", "captures");
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--hide-scrollbars"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(theme, { width = 1180, height = 756, query = "" } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 3 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto(`http://localhost:1420/?mock=showcase${query}`, { waitUntil: "networkidle0" });
  await page.addStyleTag({ content: "html[data-preview]{background:var(--background)!important}" });
  await sleep(1500);
  return page;
}

for (const theme of ["light", "dark"]) {
  let page = await open(theme);
  await page.click('[data-testid="dock-orb"]');
  await sleep(1600);
  await (await page.$("[data-radix-popper-content-wrapper] > *")).screenshot({ path: path.join(OUT, `card-orbpicker-${theme}.png`) });
  await page.screenshot({ path: path.join(OUT, `mac-orbs-${theme}.png`) });
  await page.close();

  page = await open(theme);
  await page.click('[data-testid="dock-accounts"]');
  await sleep(1600);
  await (await page.$("[data-radix-popper-content-wrapper] > *")).screenshot({ path: path.join(OUT, `card-accounts-${theme}.png`) });
  await page.close();

  page = await open(theme);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true, bubbles: true })));
  await sleep(1800);
  await page.click('[data-testid="directory-row"]');
  await sleep(1400);
  await (await page.$('[role="dialog"]')).screenshot({ path: path.join(OUT, `card-contact-${theme}.png`) });
  await page.screenshot({ path: path.join(OUT, `mac-contact-${theme}.png`) });
  await page.close();

  page = await open(theme, { width: 440, height: 760, query: "&window=call" });
  await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, `callwin-incoming-${theme}.png`) });
  await page.close();
  console.log("cards", theme);
}
await browser.close();
