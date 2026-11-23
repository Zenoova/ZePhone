// Gathers the rendered pictures into out/upload/, one folder per slot of a store, and checks each folder against that store's rules
// (exact size, no transparency, count, weight). Nothing is sent anywhere: the folders are what you drag into the store's page.
//   node scripts/pack-upload.mjs
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const dest = join(out, "upload");

const MB = 1024 * 1024;

/** One slot = one folder to fill in a store's page. `sizes` are the exact pixel sizes the store accepts; `ok` is a free check. */
const SLOTS = [
  { dir: "1-app-store-iphone-6.9", from: "iphone", sizes: ["1320x2868"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, iPhone 6.9\" (the smaller iPhones are scaled from it)" },
  { dir: "2-app-store-ipad-13", from: "ipad", sizes: ["2752x2064", "2064x2752"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, iPad 13\" (the smaller iPads are scaled from it)" },
  { dir: "3-mac-app-store", from: "mac", sizes: ["2880x1800", "2560x1600", "1440x900", "1280x800"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, macOS" },
  { dir: "4-google-play-phone", from: "android", pick: (f) => f.startsWith("android-"), sizes: null, count: [2, 8], max: 8 * MB, rule: "Play Console phone (also Samsung Galaxy Store, Huawei AppGallery, Aptoide)", ok: playOk },
  { dir: "5-google-play-tablet-10", from: "tablet", sizes: null, count: [1, 8], max: 8 * MB, rule: "Play Console 10-inch tablet", ok: playOk },
  { dir: "6-google-play-feature-graphic", from: "android", pick: (f) => f.startsWith("play-feature-graphic"), sizes: ["1024x500"], count: [1, 1], max: 15 * MB, rule: "Play Console feature graphic" },
  { dir: "7-microsoft-store", from: "desktop", sizes: null, count: [1, 10], max: 50 * MB, rule: "Microsoft Partner Center (also Snap Store, Linux listings)", ok: (w, h) => w >= 1366 && h >= 768 },
];

/** Play: every side between 320 and 3840 px, the long side at most twice the short one. */
function playOk(w, h) {
  const [s, l] = [Math.min(w, h), Math.max(w, h)];
  return s >= 320 && l <= 3840 && l <= 2 * s;
}

rmSync(dest, { recursive: true, force: true });
let failed = 0;
for (const slot of SLOTS) {
  const to = join(dest, slot.dir);
  mkdirSync(to, { recursive: true });
  const files = readdirSync(join(out, slot.from))
    .filter((f) => f.endsWith(".png") && (slot.pick ? slot.pick(f) : true))
    .sort();
  const problems = [];
  const seen = new Set();
  for (const f of files) {
    copyFileSync(join(out, slot.from, f), join(to, f));
    const m = await sharp(join(to, f)).metadata();
    const size = `${m.width}x${m.height}`;
    seen.add(size);
    if (slot.sizes && !slot.sizes.includes(size)) problems.push(`${f}: ${size}, expected ${slot.sizes.join(" or ")}`);
    if (slot.ok && !slot.ok(m.width, m.height)) problems.push(`${f}: ${size} is outside the store's limits`);
    if (m.format !== "png") problems.push(`${f}: ${m.format}, expected png`);
    if (m.hasAlpha) problems.push(`${f}: has a transparency channel`);
    if (statSync(join(to, f)).size > slot.max) problems.push(`${f}: heavier than ${slot.max / MB} MB`);
  }
  if (files.length < slot.count[0] || files.length > slot.count[1]) problems.push(`${files.length} files, the store takes ${slot.count[0]} to ${slot.count[1]}`);
  if (seen.size > 1) problems.push(`mixed sizes: ${[...seen].join(", ")}`);
  failed += problems.length;
  console.log(`${problems.length ? "✗" : "✓"} ${slot.dir.padEnd(34)} ${String(files.length).padStart(2)} × ${[...seen].join(", ").padEnd(10)} ${slot.rule}`);
  for (const p of problems) console.log(`    ${p}`);
}
console.log(failed ? `\n${failed} problem(s)` : `\nAll slots are fine: ${dest}`);
process.exit(failed ? 1 : 0);
