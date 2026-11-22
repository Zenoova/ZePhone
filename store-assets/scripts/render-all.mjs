// Renders every store picture to out/<set>/<name>.png, at the exact size of the store, with the Chrome of the Mac.
//   node scripts/render-all.mjs            everything
//   node scripts/render-all.mjs mac ipad   only the compositions whose id starts with one of these
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { enableTailwind } from "@remotion/tailwind-v4";
import { SLIDES } from "../src/slides.ts";

const root = path.resolve(import.meta.dirname, "..");
const only = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.ts"),
  webpackOverride: (config) => {
    const c = enableTailwind(config);
    return { ...c, resolve: { ...c.resolve, alias: { ...(c.resolve?.alias ?? {}), "@": path.join(root, "src") } } };
  },
});

// id → [set, final file names]. The pair and the Play graphic need a second step.
const jobs = [];
for (const s of SLIDES) jobs.push({ id: s.id, set: s.set });
jobs.push({ id: "iphone-dna-light", set: "iphone", post: "pair" });
jobs.push({ id: "play-feature", set: "android", post: "feature" });

for (const job of jobs.filter((j) => !only.length || only.some((o) => j.id.startsWith(o)))) {
  const dir = path.join(root, "out", job.set);
  await mkdir(dir, { recursive: true });
  const composition = await selectComposition({ serveUrl, id: job.id, browserExecutable: CHROME, chromiumOptions: { gl: "angle" } });
  // Pictures that need a second step (the pair to cut in two, the Play graphic to scale down) are first drawn in out/_work.
  const file = job.post ? path.join(root, "out", "_work", `${job.id}.png`) : path.join(dir, `${job.id}.png`);
  if (job.post) await mkdir(path.dirname(file), { recursive: true });
  await renderStill({ composition, serveUrl, output: file, frame: 0, browserExecutable: CHROME, chromiumOptions: { gl: "angle" } });
  if (job.post === "pair") {
    await sharp(file).extract({ left: 0, top: 0, width: 1320, height: 2868 }).toFile(path.join(dir, "iphone-01-hero.png"));
    await sharp(file).extract({ left: 1320, top: 0, width: 1320, height: 2868 }).toFile(path.join(dir, "iphone-02-hero.png"));
  }
  if (job.post === "feature") await sharp(file).resize(1024, 500, { kernel: "lanczos3" }).toFile(path.join(dir, "play-feature-graphic-1024x500.png"));
  console.log("rendered", job.id);
}
