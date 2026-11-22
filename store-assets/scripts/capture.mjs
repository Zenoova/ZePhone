// Photographs the real ZePhone UI (the Vite dev server with `?mock=showcase`: tidy fake data, no SIP) as PNGs, in the
// light and the dark theme. Needs `npm run dev` of the app on port 1420 and Google Chrome. Output: captures/<name>-<theme>.png
// Usage: node scripts/capture.mjs [name-prefix ...]   (no argument: everything)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1420/";
const OUT = path.resolve(import.meta.dirname, "..", "captures");
await mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let theme = "light";

async function shot(name, { width, height, scale, query = "", steps }) {
  if (only.length && !only.some((o) => name.startsWith(o))) return;
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto(`${BASE}?mock=showcase${query}`, { waitUntil: "networkidle0" });
  // The preview's colourful backdrop (a stand-in for macOS vibrancy) is not in the real app: use the theme's own background.
  await page.addStyleTag({ content: "html[data-preview]{background:var(--background)!important}" });
  // A browser has no safe areas: give the phone layout those of an iPhone (status bar / island on top, home indicator).
  if (query.includes("platform=mobile"))
    await page.addStyleTag({ content: "[data-testid=mobile-call-screen]{padding-top:62px!important;padding-bottom:34px!important}" });
  // iPhone, iPad and Android have the system's own navigation bar, not the desktop dock: leave the dock out of their pictures.
  if (!name.startsWith("mac-") && !name.startsWith("callwin"))
    await page.addStyleTag({ content: 'nav[aria-label="Main navigation"]{display:none!important}' });
  await sleep(1200);
  if (steps) await steps(page);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
  console.log("captured", `${name}-${theme}`, `${width * scale}x${height * scale}`);
  await page.close();
}

/** ⌘1 … ⌘5 of the app (keypad, directory, history, recordings, settings). */
const section = (key) => async (page) => {
  await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true })), key);
  await sleep(1800);
};
/** Settings: go to a tab. */
const settingsTab = (label) => async (page) => {
  await section("5")(page);
  await page.click(`[role=tab]::-p-text(${label})`);
  await sleep(1200);
};
const incoming = async (page) => {
  await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
  await sleep(1000);
};
const activeCall = async (page) => {
  const id = await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
  await sleep(700);
  await page.evaluate((i) => window.__TAURI_INTERNALS__.invoke("answer_call", { id: i }), id);
  await sleep(9000); // let the quality statistics fill in
};
const stats = async (page) => {
  await activeCall(page);
  await page.click('button[aria-label="Call options"]');
  await sleep(700);
  await page.click("::-p-text(Advanced statistics)");
  await sleep(3500);
};

const mac = { width: 1180, height: 756, scale: 3 }; // the screen of a MacBook is 1.56:1
const pad = { width: 1180, height: 960, scale: 2 }; // iPad 4:3 screen, the dock of the bottom is cropped by the frame
const tab = { width: 1280, height: 800, scale: 2 }; // Android tablet, 16:10
const phone = { width: 430, height: 932, scale: 3, query: "&platform=mobile" };
const phoneDesk = { width: 430, height: 932, scale: 3 }; // no call screen over the page: pages with the dock to crop
const callWin = { width: 440, height: 760, scale: 3, query: "&window=call" };

for (theme of ["light", "dark"]) {
  await shot("mac-dialer", mac);
  await shot("mac-directory", { ...mac, steps: section("2") });
  await shot("mac-history", { ...mac, steps: section("3") });
  await shot("mac-recordings", { ...mac, steps: section("4") });
  await shot("mac-accounts", { ...mac, steps: settingsTab("SIP accounts") });
  await shot("mac-shortcuts", { ...mac, steps: settingsTab("Shortcuts") });
  await shot("mac-audio", { ...mac, steps: settingsTab("Audio") });
  await shot("callwin-active", { ...callWin, steps: activeCall });
  await shot("callwin-stats", { ...callWin, steps: stats });

  await shot("phone-call-incoming", { ...phone, steps: incoming });
  await shot("phone-call-active", { ...phone, steps: activeCall });
  await shot("phone-stats", { ...phone, steps: stats });
  await shot("phone-dialer", phoneDesk);
  await shot("phone-directory", { ...phoneDesk, steps: section("2") });
  await shot("phone-history", { ...phoneDesk, steps: section("3") });
  await shot("phone-recordings", { ...phoneDesk, steps: section("4") });
  await shot("phone-accounts", { ...phoneDesk, steps: settingsTab("SIP accounts") });

  await shot("pad-history", { ...pad, steps: section("3") });
  await shot("pad-directory", { ...pad, steps: section("2") });
  await shot("pad-accounts", { ...pad, steps: settingsTab("SIP accounts") });
  await shot("pad-stats", { ...pad, query: "&platform=mobile", steps: stats });

  await shot("tab-history", { ...tab, steps: section("3") });
  await shot("tab-directory", { ...tab, steps: section("2") });
  await shot("tab-stats", { ...tab, query: "&platform=mobile", steps: stats });
}

await browser.close();
