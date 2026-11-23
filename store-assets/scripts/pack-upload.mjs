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
  // App Store Connect asks for the 6.1"/6.3" set (the "medium display" slot) and takes the 6.5"-6.9" one as an option: both are filled.
  { dir: "1-app-store-iphone-6.3", from: "iphone", resize: [1206, 2622], sizes: ["1206x2622"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, iPhone 6.1\"/6.3\" (required slot; the 6.9\" pictures scaled by 0.914)" },
  { dir: "1b-app-store-iphone-6.9", from: "iphone", sizes: ["1320x2868"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, iPhone 6.5\"/6.7\"/6.9\" (optional large display slot)" },
  { dir: "2-app-store-ipad-13", from: "ipad", sizes: ["2752x2064", "2064x2752"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, iPad 13\" (the smaller iPads are scaled from it)" },
  { dir: "3-mac-app-store", from: "mac", sizes: ["2880x1800", "2560x1600", "1440x900", "1280x800"], count: [1, 10], max: 10 * MB, rule: "App Store Connect, macOS" },
  { dir: "4-google-play-phone", from: "android", pick: (f) => f.startsWith("android-"), sizes: null, count: [2, 8], max: 8 * MB, rule: "Play Console phone (also Samsung Galaxy Store, Huawei AppGallery, Aptoide)", ok: playOk },
  { dir: "5-google-play-tablet", from: "tablet", sizes: ["2560x1440"], count: [1, 8], max: 8 * MB, rule: "Play Console 7-inch and 10-inch tablets (16:9 only)", ok: playOk },
  { dir: "6-google-play-feature-graphic", from: "android", pick: (f) => f.startsWith("play-feature-graphic"), sizes: ["1024x500"], count: [1, 1], max: 15 * MB, rule: "Play Console feature graphic" },
  { dir: "7-microsoft-store", from: "desktop", sizes: null, count: [1, 10], max: 50 * MB, rule: "Microsoft Partner Center (also Snap Store, Linux listings)", ok: (w, h) => w >= 1366 && h >= 768 },
];

/** Play: exactly 16:9 or 9:16, every side between 320 and 3840 px (10-inch tablets: 1080 to 7680). */
function playOk(w, h) {
  const [short, long] = [Math.min(w, h), Math.max(w, h)];
  return short >= 320 && long <= 3840 && Math.abs(long / short - 16 / 9) < 0.01;
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
    if (slot.resize) await sharp(join(out, slot.from, f)).resize(slot.resize[0], slot.resize[1], { fit: "fill" }).png({ compressionLevel: 9 }).toFile(join(to, f));
    else copyFileSync(join(out, slot.from, f), join(to, f));
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
// The 512 x 512 app icon (Google Play, Huawei AppGallery): the two companions of the Android launcher icon, black on white, flat PNG.
{
  const to = join(dest, "8-app-icon-512");
  mkdirSync(to, { recursive: true });
  const logo = await sharp(join(root, "..", "src-tauri", "icons", "icon.png")).resize(460, 460, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const file = join(to, "app-icon-512.png");
  await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ffffff" } }).composite([{ input: logo, gravity: "center" }]).removeAlpha().png({ compressionLevel: 9 }).toFile(file);
  const m = await sharp(file).metadata();
  const problems = [];
  if (m.width !== 512 || m.height !== 512) problems.push(`${m.width}x${m.height}, expected 512x512`);
  if (m.hasAlpha) problems.push("has a transparency channel");
  if (statSync(file).size > 1 * MB) problems.push("heavier than 1 MB");
  failed += problems.length;
  console.log(`${problems.length ? "✗" : "✓"} ${"8-app-icon-512".padEnd(34)} ${String(1).padStart(2)} × ${"512x512".padEnd(10)} Google Play and Huawei AppGallery app icon`);
  for (const p of problems) console.log(`    ${p}`);
}
console.log(failed ? `\n${failed} problem(s)` : `\nAll slots are fine: ${dest}`);
process.exit(failed ? 1 : 0);
