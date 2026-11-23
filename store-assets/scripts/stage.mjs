// Puts every capture where the compositions read them (public/): the browser captures, the Simulator ones (the iPad's corner,
// where iPadOS draws its window handle, is painted over with the page's own colour) and the voice orbs.
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const pub = path.join(root, "public");
await mkdir(path.join(pub, "orbs"), { recursive: true });
for (const dir of ["captures", "captures/ios", "captures/ipad", "captures/orbs"]) {
  for (const f of await readdir(path.join(root, dir)).catch(() => [])) {
    if (!f.endsWith(".png") || f.startsWith("x-")) continue;
    const from = path.join(root, dir, f);
    const to = path.join(pub, dir.endsWith("orbs") ? "orbs" : "", f);
    if (dir.endsWith("ipad")) {
      const { width, height } = await sharp(from).metadata();
      const px = await sharp(from).extract({ left: width - 260, top: height - 120, width: 1, height: 1 }).raw().toBuffer();
      const patch = await sharp({ create: { width: 150, height: 120, channels: 3, background: { r: px[0], g: px[1], b: px[2] } } }).png().toBuffer();
      await sharp(from).composite([{ input: patch, left: width - 150, top: height - 120 }]).toFile(to);
    } else await copyFile(from, to);
  }
}
console.log("staged");
