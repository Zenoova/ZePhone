// Renders every store picture to out/<set>/<name>.png, at the exact size of the store, with the Chrome of the Mac.
//   node scripts/render-all.mjs            everything
//   node scripts/render-all.mjs mac ipad   only the compositions whose id starts with one of these
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { enableTailwind } from "@remotion/tailwind-v4";
import { PAIRS, SIZES, SLIDES } from "../src/slides.ts";

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

// One job per picture; the pairs (one panorama cut in two) and the Play graphic need a second step.
const jobs = [];
for (const s of SLIDES) jobs.push({ id: s.id, set: s.set });
for (const p of PAIRS) jobs.push({ id: p.id, set: p.set, pair: p });
jobs.push({ id: "play-feature", set: "android", post: "feature" });

for (const job of jobs.filter((j) => !only.length || only.some((o) => j.id.startsWith(o)))) {
  const dir = path.join(root, "out", job.set);
  await mkdir(dir, { recursive: true });
  const composition = await selectComposition({ serveUrl, id: job.id, browserExecutable: CHROME, chromiumOptions: { gl: "angle" } });
  // Pictures that need a second step (the pair to cut in two, the Play graphic to scale down) are first drawn in out/_work.
  const work = job.pair || job.post;
  const file = work ? path.join(root, "out", "_work", `${job.id}.png`) : path.join(dir, `${job.id}.png`);
  if (work) await mkdir(path.dirname(file), { recursive: true });
  await renderStill({ composition, serveUrl, output: file, frame: 0, browserExecutable: CHROME, chromiumOptions: { gl: "angle" } });
  if (job.pair) {
    const { width, height } = SIZES[job.pair.kind];
    for (const [i, name] of job.pair.files.entries()) await sharp(file).extract({ left: i * width, top: 0, width, height }).toFile(path.join(dir, `${name}.png`));
  }
  if (job.post === "feature") await sharp(file).resize(1024, 500, { kernel: "lanczos3" }).toFile(path.join(dir, "play-feature-graphic-1024x500.png"));
  console.log("rendered", job.id);
}
