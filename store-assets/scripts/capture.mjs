// Captures the real ZePhone UI (the Vite dev server with `?mock=showcase`: tidy fake data, no SIP) as PNGs.
// Needs `npm run dev` of the app on port 1420 and Google Chrome. Output: captures/<name>.png
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1420/";
const OUT = path.resolve(import.meta.dirname, "..", "captures");
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a page of the app, run the steps, save the screenshot. */
let theme = "light";
async function shot(name, { width, height, scale, query, steps }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto(`${BASE}?mock=showcase${query ?? ""}`, { waitUntil: "networkidle0" });
  // A browser has no safe areas: give the phone layout those of an iPhone (status bar / island on top, home indicator).
  if (query?.includes("platform=mobile"))
    await page.addStyleTag({ content: "[data-testid=mobile-call-screen]{padding-top:62px!important;padding-bottom:34px!important}" });
  // The preview's colourful backdrop (a stand-in for macOS vibrancy) is not in the real app: use the theme's own background.
  await page.addStyleTag({ content: "html[data-preview]{background:var(--background)!important}" });
  await sleep(1200);
  if (steps) await steps(page);
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
  console.log("captured", `${name}-${theme}`, `${width * scale}x${height * scale}`);
  await page.close();
}

/** ⌘1 … ⌘5 of the app (keypad, directory, history, recordings, settings). */
const section = (key) => (page) =>
  page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true })), key);

for (theme of ["light", "dark"]) {
  const desktop = { width: 1180, height: 756, scale: 3 };
  await shot("mac-dialer", { ...desktop });
  await shot("mac-directory", { ...desktop, steps: section("2") });
  await shot("mac-history", { ...desktop, steps: section("3") });
  await shot("mac-recordings", { ...desktop, steps: section("4") });
  await shot("mac-settings", { ...desktop, steps: section("5") });
  
  // The call window: a separate page in the app, `?window=call`.
  const callWin = { width: 440, height: 760, scale: 3, query: "&window=call" };
  await shot("mac-call-incoming", {
    ...callWin,
    steps: async (page) => {
      await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
      await sleep(900);
    },
  });
  await shot("mac-call-active", {
    ...callWin,
    steps: async (page) => {
      const id = await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
      await sleep(700);
      await page.evaluate((i) => window.__TAURI_INTERNALS__.invoke("answer_call", { id: i }), id);
      await sleep(9000); // let the quality statistics fill in
    },
  });
  
  // The phone layout (`?platform=mobile`): the call screen covers the whole page, so it is the real thing with no dock.
  const phone = { width: 430, height: 932, scale: 3, query: "&platform=mobile" };
  await shot("phone-call-incoming", {
    ...phone,
    steps: async (page) => {
      await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
      await sleep(900);
    },
  });
  await shot("phone-call-active", {
    ...phone,
    steps: async (page) => {
      const id = await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
      await sleep(700);
      await page.evaluate((i) => window.__TAURI_INTERNALS__.invoke("answer_call", { id: i }), id);
      await sleep(9000);
    },
  });
  await shot("phone-dialer", { ...phone });
  await shot("phone-history", { ...phone, steps: section("3") });
  await shot("phone-recordings", { ...phone, steps: section("4") });
  await shot("phone-settings", { ...phone, steps: section("5") });
}

await browser.close();
