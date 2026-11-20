#!/usr/bin/env node
// Writes the ZePhone logo as SVG (src-tauri/icons/source/zephone-logo{,-dark}.svg and public/zephone-icon.svg).
//
// Turn the SVG into the 1024 px PNG with any rasterizer (for instance @resvg/resvg-js), then let Tauri make every
// icon size:  npx tauri icon src-tauri/icons/source/zephone-logo-1024.png
//
// The ZePhone logo, drawn in the manner of the Zenoova mark: two shapes that overlap, one drawn as an outline and the
// other solid, the part they share solid, and a thin gap where one crosses the other. Here the two shapes are two of
// the SIP account avatars (blobatars) instead of two circles. Black and white only.
import { blobatar } from "blobatar";
import fs from "node:fs";

const OUT_ICON = "src-tauri/icons/source";
const OUT_PUBLIC = "public";
const FACE_OUTLINE = "zenoova";   // drawn as an outline (the left circle of the Zenoova mark)
const FACE_SOLID = "zephone";     // drawn solid (the right circle)

const W = 179.71, H = 107.26;       // the Zenoova mark's own box
const S = 1.8;                      // avatars are drawn in a 100-unit box
const AX = 60, BX = 138;            // centres, left and right
const FLIP = true;                  // the outline avatar is mirrored so its bumps stay out of the shared area
const OUTLINE = 4.2, GAP = 4.2;     // ring thickness and gap, as in the mark

/** The two groups of a blobatar: the body shapes, and the eyes. */
function parts(name) {
  const svg = blobatar(name, { palette: { head: "#000", eye: "#fff" } });
  const groups = [...svg.matchAll(/<g fill="#[0-9a-f]+">(.*?)<\/g>/g)].map((m) => m[1]);
  return { body: groups[0], eyes: groups[1] ?? "" };
}

/**
 * The mark on a transparent background: nothing is painted in "paper" colour. Where one shape crosses the other, the
 * gap is cut out of the ink with masks, so the logo works on any background.
 */
function mark(ink) {
  const a = parts(FACE_OUTLINE), b = parts(FACE_SOLID);
  const ta = FLIP ? `translate(${AX + 50 * S} ${H / 2 - 50 * S}) scale(${-S} ${S})` : `translate(${AX - 50 * S} ${H / 2 - 50 * S}) scale(${S})`;
  const tb = `translate(${BX - 50 * S} ${H / 2 - 50 * S}) scale(${S})`;
  // Strokes are in the avatars' own units: divide by the scale to get mark units.
  const ring = (OUTLINE * 2) / S, gap = (GAP * 2) / S;
  const box = `x="-20" y="-20" width="${W + 40}" height="${H + 40}"`;
  return `
<defs>
  <!-- the outline avatar's ring (its body grown by the ring thickness, minus the body), minus a gap around the solid avatar -->
  <mask id="m-ring" maskUnits="userSpaceOnUse" ${box}>
    <rect ${box} fill="#000"/>
    <g transform="${ta}">
      <g fill="#fff" stroke="#fff" stroke-width="${ring}" stroke-linejoin="round">${a.body}</g>
      <g fill="#000">${a.body}</g>
    </g>
    <g transform="${tb}"><g fill="#000" stroke="#000" stroke-width="${gap}" stroke-linejoin="round">${b.body}</g></g>
  </mask>
  <!-- the solid avatar: everything, minus where the ring crosses it, minus its eyes -->
  <mask id="m-solid" maskUnits="userSpaceOnUse" ${box}>
    <rect ${box} fill="#fff"/>
    <g transform="${ta}">
      <g fill="#000" stroke="#000" stroke-width="${ring}" stroke-linejoin="round">${a.body}</g>
      <g fill="#fff">${a.body}</g>
    </g>
    <g transform="${tb}" fill="#000">${b.eyes}</g>
  </mask>
</defs>
<rect ${box} fill="${ink}" mask="url(#m-ring)"/>
<g mask="url(#m-solid)"><g transform="${tb}" fill="${ink}">${b.body}</g></g>
<g transform="${ta}" fill="${ink}">${a.eyes}</g>`;
}

function icon(ink) {
  const k = 4.6, x = (1024 - W * k) / 2, y = (1024 - H * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k})">${mark(ink)}</g>
</svg>
`;
}
fs.mkdirSync(OUT_ICON, { recursive: true });
fs.mkdirSync(OUT_PUBLIC, { recursive: true });
fs.writeFileSync(`${OUT_ICON}/zephone-logo.svg`, icon("#000000"));
fs.writeFileSync(`${OUT_ICON}/zephone-logo-dark.svg`, icon("#ffffff"));
fs.writeFileSync(`${OUT_PUBLIC}/zephone-icon.svg`, icon("#000000"));
