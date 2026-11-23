import { Activity, AudioLines, Command, Disc3, Layers, Mic, PanelBottom, ShieldCheck, Smile, SunMoon, Users, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, staticFile } from "remotion";
import orbs from "../orbs.json";
import { SIZES, type CardSpec, type Kind, type Slide as SlideSpec } from "../slides";
import { font, palette, type Theme } from "../theme";
import { MacDevice, PadDevice, PhoneDevice, RATIO, TabletDevice, WinDesktop, WinLaptop } from "./devices";
import { FxLayer } from "./FxLayer";
import { Chip, Face, Header, Orb, Shot, glass, shotUrl } from "./ui";
import { usePreload } from "./usePreload";

const isPortrait = (k: Kind) => k === "iphone" || k === "android";

/** The pictures of the captures a slide needs, so the render waits for them. */
const urlsOf = (s: SlideSpec): string[] => {
  const u: string[] = [staticFile("logo.svg")];
  if (s.screen) u.push(shotUrl(s.screen, s.theme));
  if (s.scene) u.push(shotUrl(s.scene.main, s.theme), shotUrl(s.scene.call, s.theme));
  for (const c of s.cards ?? []) u.push(shotUrl(c.src, s.theme));
  if (s.recipe === "orbs") u.push(...orbs.map((o) => staticFile(`orbs/${o.id}.png`)), shotUrl("card-orbpicker", s.theme));
  if (s.recipe === "faces") u.push(shotUrl("card-accounts", s.theme));
  if (s.kind === "mac") u.push(staticFile("macbook-frame.webp"));
  return u;
};

/** The screen of a MacBook: the capture, or the main window with the call window in front of it. */
const MacScene = ({ s, width }: { s: SlideSpec; width: number }) => {
  const p = palette(s.theme);
  if (!s.scene) return <img src={shotUrl(s.screen!, s.theme)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />;
  const h = width * 0.78 * (893 / 1394);
  const mainH = h * 0.74;
  const mainW = mainH * (1180 / 756);
  const callH = h * 0.86;
  const callW = callH * (440 / 760);
  const left = (width * 0.778 - (mainW + callW * 0.6)) / 2;
  const win = (w: number, ht: number, x: number, y: number, src: string): ReactNode => (
    <img src={src} style={{ position: "absolute", left: x, top: y, width: w, height: ht, borderRadius: ht * 0.025, boxShadow: `0 ${ht * 0.03}px ${ht * 0.09}px ${p.shadow}`, objectFit: "cover" }} />
  );
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: p.desk }}>
      {win(mainW, mainH, left, h * 0.1, shotUrl(s.scene.main, s.theme))}
      {win(callW, callH, left + mainW - callW * 0.4, h * 0.07, shotUrl(s.scene.call, s.theme))}
    </div>
  );
};

/** The device of the slide (and where it ends, so that cards and chips can sit on its edges). */
const place = (s: SlideSpec, W: number, H: number) => {
  const k = s.kind;
  const portrait = isPortrait(k);
  const dw = portrait ? W * (k === "iphone" ? 0.8 : 0.64) : W * (s.split ? 0.6 : { ipad: 0.7, tablet: 0.64, mac: 0.7, desktop: 0.55 }[k as "ipad"]);
  const ratio = { iphone: RATIO.iphone, android: RATIO.android, ipad: RATIO.ipad, tablet: RATIO.tablet, mac: RATIO.mac, desktop: RATIO.win }[k];
  const dh = dw / ratio;
  const left = portrait ? (W - dw) / 2 : s.split ? W * 0.37 : (W - dw) / 2;
  const top = portrait ? H * (k === "iphone" ? 0.285 : 0.27) : s.split ? (H - dh) / 2 + H * 0.02 : H * (k === "desktop" ? 0.285 : 0.265);
  return { left, top, dw, dh };
};

const DeviceFor = ({ s, dw }: { s: SlideSpec; dw: number }) => {
  const src = s.screen ? shotUrl(s.screen, s.theme) : "";
  switch (s.kind) {
    case "iphone":
    case "android":
      return <PhoneDevice kind={s.kind} theme={s.theme} src={src} width={dw} />;
    case "ipad":
      return <PadDevice theme={s.theme} src={src} width={dw} />;
    case "tablet":
      return <TabletDevice theme={s.theme} src={src} width={dw} />;
    case "mac":
      return (
        <MacDevice theme={s.theme} width={dw}>
          <MacScene s={s} width={dw} />
        </MacDevice>
      );
    case "desktop": {
      const sc = s.scene!;
      // Windows on a 1920 × 1200 screen: the app and, in front of it, the call window.
      const wins = [
        { src: shotUrl(sc.main, s.theme), x: 205, y: 150, w: 1100, h: 34 + (1100 * 756) / 1180 },
        { src: shotUrl(sc.call, s.theme), x: 1245, y: 92, w: 470, h: 34 + (470 * 760) / 440 },
      ];
      return (
        <WinLaptop theme={s.theme} width={dw}>
          <WinDesktop theme={s.theme} width={dw * 0.978} windows={wins} />
        </WinLaptop>
      );
    }
  }
};

const Cards = ({ cards, theme, W, H }: { cards: CardSpec[]; theme: Theme; W: number; H: number }) => (
  <>
    {cards.map((c, i) => (
      <Shot
        key={i}
        src={shotUrl(c.src, theme)}
        aspect={c.aspect}
        crop={c.crop}
        width={c.w * W}
        radius={(c.radius ?? 60) * (W / 1320)}
        theme={theme}
        style={{ left: c.x * W, top: c.y * H, transform: `rotate(${c.rot ?? 0}deg)`, zIndex: 10 + (c.z ?? i) }}
      />
    ))}
  </>
);

/** Deterministic scatter of circles in a box, none overlapping the others (or the fixed ones), all inside the box. */
const scatter = (
  count: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  fixed: Array<{ x: number; y: number; r: number }>,
  sizes: number[],
  gap: number,
  clipX = false,
) => {
  const out: Array<{ x: number; y: number; r: number }> = [];
  let t = 0.31;
  for (let tries = 0; out.length < count && tries < 6000; tries++) {
    t = (t + 0.6180339887) % 1;
    const u = (t * 7.31) % 1;
    const r = sizes[out.length % sizes.length]! / 2;
    const x = box.x0 + (clipX ? 0 : r) + t * (box.x1 - box.x0 - (clipX ? 0 : 2 * r));
    const y = box.y0 + r + u * (box.y1 - box.y0 - 2 * r);
    if ([...fixed, ...out].every((c) => Math.hypot(c.x - x, c.y - y) > c.r + r + gap)) out.push({ x, y, r });
  }
  return out;
};

/** The unit of a picture: its short side, so text and objects keep their proportions on every shape. */
const unitOf = (W: number, H: number) => Math.min(W, H * 0.62);

/** A ball scene: one big circle in the middle, six around it, the rest scattered. Used by the orbs and by the faces. */
const bubbles = (W: number, H: number, portrait: boolean) => {
  const u = unitOf(W, H);
  const D = portrait ? W * 0.46 : H * 0.34;
  const cx = W / 2;
  const cy = portrait ? H * 0.52 : H * 0.49;
  const d1 = portrait ? D * 0.34 : D * 0.3;
  // Portrait: a circle round the big one. Landscape: an ellipse, wide and low, so it stays between the title and the picker.
  const rx = portrait ? D * 0.88 : D * 1.5;
  const ry = portrait ? D * 0.88 : D * 0.62;
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + (portrait ? Math.PI / 6 : 0);
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, r: d1 / 2 };
  });
  const box = portrait ? { x0: 0, y0: H * 0.285, x1: W, y1: H * 0.765 } : { x0: W * 0.05, y0: H * 0.235, x1: W * 0.95, y1: H * 0.745 };
  const extras = scatter(7, box, [{ x: cx, y: cy, r: D / 2 + u * 0.02 }, ...ring.map((c) => ({ ...c, r: c.r + u * 0.015 }))], [u * 0.13, u * 0.09, u * 0.11, u * 0.075], u * 0.025);
  return { cx, cy, D, ring, extras };
};

/** "Give every call a voice": the 14 orbs of the app on the ripples of the rings, and the real picker underneath. */
const OrbsScene = ({ s, W, H }: { s: SlideSpec; W: number; H: number }) => {
  const portrait = isPortrait(s.kind);
  const { cx, cy, D, ring, extras } = bubbles(W, H, portrait);
  const others = orbs.filter((o) => o.id !== "shdr-32").map((o) => o.id);
  const pickW = portrait ? W * 0.8 : Math.min(W * 0.3, H * 0.62);
  return (
    <>
      <Orb id="shdr-32" size={D} style={{ left: cx - D / 2, top: cy - D / 2, filter: `drop-shadow(0 ${D * 0.05}px ${D * 0.1}px ${palette(s.theme).shadow})` }} />
      {[...ring, ...extras].map((c, i) => (
        <Orb key={i} id={others[i % others.length]!} size={c.r * 2} style={{ left: c.x - c.r, top: c.y - c.r, filter: `drop-shadow(0 ${c.r * 0.12}px ${c.r * 0.25}px ${palette(s.theme).shadow})` }} />
      ))}
      <Shot
        src={shotUrl("card-orbpicker", s.theme)}
        aspect={1152 / 522}
        crop={[0, 0, 1, 1]}
        width={pickW}
        radius={pickW * 0.035}
        theme={s.theme}
        style={{ left: (W - pickW) / 2, top: portrait ? H * 0.79 : H * 0.76, zIndex: 20 }}
      />
    </>
  );
};

/** The names of the faces: the two real accounts of the app, and invented lines. */
const LINES = [
  { name: "Office", seed: "1001@example.com" },
  { name: "Home line", seed: "0412345678@voipbox.net" },
  { name: "Reception", seed: "2001@pbx.acme.example" },
  { name: "Warehouse", seed: "3004@dock.acme.example" },
  { name: "Support", seed: "support@help.example.net" },
  { name: "Mobile", seed: "0687654321@sip.example.org" },
  { name: "Sales", seed: "4010@pbx.acme.example" },
  { name: "Night desk", seed: "9000@night.example.com" },
];

/** "Every line has a face": the little companions the app draws from each account, around the account list of the dock. */
const FacesScene = ({ s, W, H }: { s: SlideSpec; W: number; H: number }) => {
  const portrait = isPortrait(s.kind);
  const p = palette(s.theme);
  const { cx, cy, D, ring, extras } = bubbles(W, H, portrait);
  const u = unitOf(W, H);
  const pickW = portrait ? W * 0.62 : Math.min(W * 0.22, H * 0.46);
  const seeds = [...LINES.slice(2), ...LINES.slice(2)];
  return (
    <>
      <div style={{ position: "absolute", left: cx - D * 0.43, top: cy - D * 0.43, filter: `drop-shadow(0 ${D * 0.04}px ${D * 0.08}px ${p.shadow})` }}>
        <Face seed={LINES[0]!.seed} size={D * 0.86} status="ok" ring={p.bg} />
      </div>
      <div style={{ position: "absolute", left: cx - D * 0.43, top: cy + D * 0.5, width: D * 0.86, display: "flex", justifyContent: "center" }}>
        <Chip theme={s.theme} size={u * 0.026} dot="#00a152">
          Office · Registered
        </Chip>
      </div>
      {ring.map((c, i) => {
        const line = i === 0 ? LINES[1]! : seeds[i - 1]!;
        return (
          <div key={i} style={{ position: "absolute", left: c.x - c.r * 0.95, top: c.y - c.r * 0.95, filter: `drop-shadow(0 ${c.r * 0.1}px ${c.r * 0.2}px ${p.shadow})` }}>
            <Face seed={line.seed} size={c.r * 1.9} status={i === 4 ? "off" : "ok"} ring={p.bg} />
          </div>
        );
      })}
      {extras.map((c, i) => (
        <div key={i} style={{ position: "absolute", left: c.x - c.r * 0.95, top: c.y - c.r * 0.95, opacity: 0.92 }}>
          <Face seed={`${seeds[(i + 3) % seeds.length]!.seed}-${i}`} size={c.r * 1.9} status="ok" ring={p.bg} />
        </div>
      ))}
      <Shot
        src={shotUrl("card-accounts", s.theme)}
        aspect={960 / 564}
        crop={[0, 0, 1, 1]}
        width={pickW}
        radius={pickW * 0.06}
        theme={s.theme}
        style={{ left: (W - pickW) / 2, top: portrait ? H * 0.8 : H * 0.7, zIndex: 20 }}
      />
    </>
  );
};

const TILES: Array<{ icon: LucideIcon; text: string; hue: number }> = [
  { icon: Users, text: "Your contacts, LDAP and Microsoft 365 in one search", hue: 215 },
  { icon: Activity, text: "Call statistics in plain words", hue: 28 },
  { icon: AudioLines, text: "14 living voice orbs", hue: 320 },
  { icon: Smile, text: "A little face for every account", hue: 190 },
  { icon: ShieldCheck, text: "TLS and SRTP, certificates always checked", hue: 145 },
  { icon: Layers, text: "Several accounts at once", hue: 255 },
  { icon: Mic, text: "Opus HD voice", hue: 350 },
  { icon: Disc3, text: "Recordings kept on your device only", hue: 45 },
  { icon: SunMoon, text: "Light and dark themes", hue: 270 },
];
const LAST: Record<Kind, { icon: LucideIcon; text: string }> = {
  iphone: { icon: PanelBottom, text: "Liquid Glass navigation" },
  ipad: { icon: PanelBottom, text: "Liquid Glass navigation" },
  android: { icon: PanelBottom, text: "Material navigation bar" },
  tablet: { icon: PanelBottom, text: "Material navigation bar" },
  mac: { icon: Command, text: "Global shortcuts and a command line" },
  desktop: { icon: Command, text: "Global shortcuts and headset buttons" },
};

/** "Built for work": what ZePhone does that a plain dialler does not, as a grid of glass tiles. */
const FeaturesScene = ({ s, W, H }: { s: SlideSpec; W: number; H: number }) => {
  const portrait = isPortrait(s.kind);
  const p = palette(s.theme);
  const tiles = [...TILES, LAST[s.kind]].map((t, i) => ({ hue: 0, ...t, i }));
  const cols = portrait ? 2 : 5;
  const rows = Math.ceil(tiles.length / cols);
  const gridW = portrait ? W * 0.88 : W * 0.86;
  const top = portrait ? H * 0.355 : H * 0.4;
  const gridH = portrait ? H * 0.57 : H * 0.52;
  const gap = gridW * (portrait ? 0.03 : 0.014);
  const tw = (gridW - gap * (cols - 1)) / cols;
  const th = (gridH - gap * (rows - 1)) / rows;
  // A phone's tiles are rows (icon, then text) so three lines of text fit; a landscape picture's are columns (icon above text).
  const fs = portrait ? Math.min(tw * 0.075, th * 0.2) : Math.min(tw * 0.1, th * 0.15);
  return (
    <div style={{ position: "absolute", left: (W - gridW) / 2, top, width: gridW, height: gridH, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap }}>
      {tiles.map((t, i) => {
        const Icon = t.icon;
        const hue = t.hue || 215;
        return (
          <div
            key={i}
            style={{
              ...glass(s.theme, Math.min(tw, th) * 0.12, true),
              display: "flex",
              flexDirection: portrait ? "row" : "column",
              alignItems: portrait ? "center" : "flex-start",
              justifyContent: portrait ? "flex-start" : "space-between",
              gap: portrait ? tw * 0.05 : 0,
              padding: tw * 0.07,
              fontFamily: font,
              color: p.ink,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <span style={{ flexShrink: 0, width: fs * 2.4, height: fs * 2.4, borderRadius: "50%", display: "grid", placeItems: "center", background: `hsl(${hue} ${s.theme === "light" ? 85 : 55}% ${s.theme === "light" ? 90 : 26}%)`, color: `hsl(${hue} 70% ${s.theme === "light" ? 38 : 75}%)` }}>
              <Icon size={fs * 1.3} strokeWidth={1.9} />
            </span>
            <span style={{ fontSize: fs, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.12 }}>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
};

/** One store picture: a headline, and what the app does on the device of the platform, with real pieces of it floating around. */
export const Slide = ({ slide }: { slide: SlideSpec }) => {
  const s = slide;
  const { width: W, height: H } = SIZES[s.kind];
  const p = palette(s.theme);
  const portrait = isPortrait(s.kind);
  usePreload(urlsOf(s));
  const dev = place(s, W, H);
  const origin: [number, number] = s.recipe === "device" ? (portrait ? [0.5, 0.62] : s.split ? [0.68, 0.55] : [0.5, 0.6]) : portrait ? [0.5, 0.52] : [0.5, 0.55];
  const chipSize = (portrait ? W : H) * 0.027;

  const header = portrait ? (
    <Header theme={s.theme} unit={W} title={s.title} sub={s.sub} logo={s.logo} top={H * (s.logo ? 0.055 : 0.075)} titleScale={s.kind === "iphone" ? 0.092 : 0.082} subScale={s.kind === "iphone" ? 0.034 : 0.036} logoScale={s.kind === "iphone" ? 0.19 : 0.2} />
  ) : s.split ? (
    <Header theme={s.theme} unit={W} title={s.title} sub={s.sub} logo={s.logo} align="left" left={W * 0.055} width={W * 0.3} top={H * 0.3} titleScale={0.04} subScale={0.0175} logoScale={0.06} />
  ) : (
    <Header theme={s.theme} unit={W} title={s.title} sub={s.sub} logo={s.logo} top={H * (s.logo ? 0.05 : 0.065)} titleScale={s.kind === "desktop" ? 0.05 : 0.046} subScale={s.kind === "desktop" ? 0.0215 : 0.0205} logoScale={s.kind === "desktop" ? 0.07 : 0.062} />
  );

  return (
    <AbsoluteFill style={{ background: p.bg, fontFamily: font }}>
      <FxLayer origin={origin} cell={Math.max(4, Math.round(W / 420))} color={p.dots} />
      {header}
      {s.recipe === "device" && (
        <>
          <div style={{ position: "absolute", left: dev.left, top: dev.top }}>
            <DeviceFor s={s} dw={dev.dw} />
          </div>
          <Cards cards={s.cards ?? []} theme={s.theme} W={W} H={H} />
          {(s.chips ?? []).map((c, i) => (
            <div key={i} style={{ position: "absolute", left: c.x * W, top: c.y * H, transform: `rotate(${c.rot ?? 0}deg)`, zIndex: 30 }}>
              <Chip theme={s.theme} size={chipSize} dot={c.dot}>
                {c.text}
              </Chip>
            </div>
          ))}
        </>
      )}
      {s.recipe === "orbs" && <OrbsScene s={s} W={W} H={H} />}
      {s.recipe === "faces" && <FacesScene s={s} W={W} H={H} />}
      {s.recipe === "features" && <FeaturesScene s={s} W={W} H={H} />}
    </AbsoluteFill>
  );
};

export type { CSSProperties };
