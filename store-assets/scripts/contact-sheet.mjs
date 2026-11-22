// Builds a contact sheet per set (out/_sheets/<set>.png) to review a whole set at a glance.
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const out = path.resolve(import.meta.dirname, "..", "out");
await mkdir(path.join(out, "_sheets"), { recursive: true });
for (const set of ["iphone", "ipad", "mac", "android", "tablet", "desktop"]) {
  const files = (await readdir(path.join(out, set))).filter((f) => /^(iphone|ipad|mac|android|tablet|desktop)-\d\d-.*\.png$/.test(f)).sort();
  const H = 520;
  const tiles = await Promise.all(files.map(async (f) => sharp(path.join(out, set, f)).resize({ height: H }).png().toBuffer({ resolveWithObject: true })));
  const gap = 16;
  const width = tiles.reduce((w, t) => w + t.info.width + gap, gap);
  const composites = [];
  let x = gap;
  for (const t of tiles) {
    composites.push({ input: t.data, left: x, top: gap });
    x += t.info.width + gap;
  }
  await sharp({ create: { width, height: H + gap * 2, channels: 3, background: "#8a8a8e" } }).composite(composites).png().toFile(path.join(out, "_sheets", `${set}.png`));
  console.log(set, files.length, `${width}x${H + gap * 2}`);
}
