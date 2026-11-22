// Cuts a double-width render into two App Store screenshots: node scripts/split.mjs out/phone-pair.png out/ios-02 out/ios-03
import sharp from "sharp";

const [src, left, right] = process.argv.slice(2);
const { width, height } = await sharp(src).metadata();
const half = width / 2;
await sharp(src).extract({ left: 0, top: 0, width: half, height }).toFile(`${left}.png`);
await sharp(src).extract({ left: half, top: 0, width: half, height }).toFile(`${right}.png`);
console.log(`${left}.png and ${right}.png: ${half}x${height}`);
