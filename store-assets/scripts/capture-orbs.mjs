// The 14 voice orbs of the app, one transparent PNG each (captures/orbs/<id>.png): the canvas of the call screen, with the orb
// chosen through the settings before the call. Needs `npm run dev` of the app on port 1420 and Google Chrome.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(import.meta.dirname, "..", "captures", "orbs");
await mkdir(OUT, { recursive: true });
const src = await readFile(path.resolve(import.meta.dirname, "../../src/lib/voice-orbs.ts"), "utf8");
const orbs = [...src.matchAll(/id: "(shdr-\d+)", label: "([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
await writeFile(path.join(OUT, "orbs.json"), JSON.stringify(orbs, null, 1));

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const { id, label } of orbs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3 });
  // Keep the drawing buffer so the canvas can be read back with its transparency.
  await page.evaluateOnNewDocument(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      return orig.call(this, type, type && String(type).startsWith("webgl") ? { ...(attrs || {}), preserveDrawingBuffer: true } : attrs);
    };
  });
  await page.goto("http://localhost:1420/?mock=showcase&platform=mobile", { waitUntil: "networkidle0" });
  await sleep(800);
  await page.evaluate(async (orb) => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const s = await inv("get_settings");
    s.general.voiceOrb = orb;
    await inv("update_settings", { settings: s });
  }, id);
  const callId = await page.evaluate(() => window.__mock.incoming("Alice Durand", "1001"));
  await sleep(600);
  await page.evaluate((i) => window.__TAURI_INTERNALS__.invoke("answer_call", { id: i }), callId);
  await sleep(4500);
  const data = await page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")].sort((a, b) => b.width - a.width);
    return cs[0] ? { url: cs[0].toDataURL("image/png"), w: cs[0].width, h: cs[0].height } : null;
  });
  if (!data) console.log("no canvas for", id);
  else {
    await writeFile(path.join(OUT, `${id}.png`), Buffer.from(data.url.split(",")[1], "base64"));
    console.log("orb", id, label, `${data.w}x${data.h}`);
  }
  await page.close();
}
await browser.close();
