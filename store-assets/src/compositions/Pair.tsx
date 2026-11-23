import { AbsoluteFill } from "remotion";
import { DnaCarousel } from "../components/dna-carousel";
import { SIZES, type Kind, type Pair } from "../slides";
import { font, palette } from "../theme";
import { WinDesktop, WinLaptop } from "./devices";
import { FxLayer } from "./FxLayer";
import { Logo, shotUrl } from "./ui";
import { usePreload } from "./usePreload";
import { staticFile } from "remotion";

/** Width / height of a card of the helix, by device: a phone's screen, a tablet's, a laptop's. */
const CARD: Record<Kind, number> = { iphone: 760 / 1500, android: 760 / 1500, ipad: 4 / 3, tablet: 1.6, mac: 1.56, desktop: 1.6 };

/** The size of one panorama: twice the width of a picture. */
export const pairSize = (kind: Kind) => ({ width: SIZES[kind].width * 2, height: SIZES[kind].height });


/**
 * The helix of the phones does not suit wide screens (the cards come out huge), so tablets and laptops get a fan: six cards on a
 * shallow arc, turned towards the middle, the seam falling between the third and the fourth.
 */
const Fan = ({ screens, theme, W, top, height, aspect }: { screens: string[]; theme: Pair["theme"]; W: number; top: number; height: number; aspect: number }) => {
  const p = palette(theme);
  const cw = W * 0.56;
  const ch = cw / aspect;
  const step = cw * 0.52;
  const n = screens.length;
  return (
    <div style={{ position: "absolute", left: 0, width: W * 2, top, height, perspective: W * 1.5, perspectiveOrigin: "50% 45%" }}>
      {screens.map((name, i) => {
        const k = i - (n - 1) / 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: W + k * step - cw / 2,
              top: (height - ch) / 2,
              width: cw,
              height: ch,
              borderRadius: cw * 0.03,
              overflow: "hidden",
              background: p.bg,
              boxShadow: `0 0 0 1px ${p.glassLine}, 0 ${cw * 0.04}px ${cw * 0.1}px ${p.shadow}`,
              transform: `translateZ(${-Math.abs(k) * cw * 0.16}px) rotateY(${-k * 13}deg)`,
              zIndex: 10 - Math.round(Math.abs(k)),
            }}
          >
            <img src={shotUrl(name, theme)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
          </div>
        );
      })}
    </div>
  );
};

/**
 * Two pictures in one (2 × the width of a store picture), cut in two by `scripts/render-all.mjs`: a helix of real screens, or two
 * laptops, runs across the seam, so side by side on the product page they read as one. The title has one line per picture, and
 * the logo sits above the first one.
 */
export const PairSlide = ({ pair }: { pair: Pair }) => {
  const { width: W, height: H } = SIZES[pair.kind];
  const theme = pair.theme;
  const p = palette(theme);
  const portrait = pair.kind === "iphone" || pair.kind === "android";
  usePreload([staticFile("logo.svg"), ...pair.screens.map((n) => shotUrl(n, theme)), ...(pair.twin ? [pair.twin.a.main, pair.twin.a.call, pair.twin.b.main, pair.twin.b.call].map((n) => shotUrl(n, theme)) : [])]);

  const font1 = W * (portrait ? 0.148 : 0.062);
  const logo = W * (portrait ? 0.21 : 0.07);
  const logoTop = H * (portrait ? 0.052 : 0.04);
  const titleTop = logoTop + logo * 1.02;
  const line = { position: "absolute" as const, top: titleTop, width: W, textAlign: "center" as const, fontSize: font1, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1, color: p.ink };

  const itemW = W * 0.576;
  const itemH = itemW / CARD[pair.kind];
  const cardsTop = portrait ? H * 0.251 : titleTop + font1 * 1.25;

  return (
    <AbsoluteFill style={{ background: p.bg, fontFamily: font }}>
      <FxLayer origin={[0.5, 0.6]} cell={Math.max(4, Math.round(W / 420))} color={p.dots} />
      <Logo theme={theme} size={logo} style={{ position: "absolute", left: W / 2 - logo / 2, top: logoTop }} />
      <div style={{ ...line, left: 0 }}>{pair.titleA}</div>
      <div style={{ ...line, left: W, color: p.muted }}>{pair.titleB}</div>
      {pair.twin ? (
        <>
          {([pair.twin.a, pair.twin.b] as const).map((t, i) => {
            const dw = W * 0.6;
            const wins = [
              { src: shotUrl(t.main, theme), x: 205, y: 150, w: 1100, h: 34 + (1100 * 756) / 1180 },
              { src: shotUrl(t.call, theme), x: 1245, y: 92, w: 470, h: 34 + (470 * 760) / 440 },
            ];
            return (
              <div key={i} style={{ position: "absolute", left: W * i + (W - dw) / 2, top: H * 0.28 }}>
                <WinLaptop theme={theme} width={dw}>
                  <WinDesktop theme={theme} width={dw * 0.978} windows={wins} />
                </WinLaptop>
              </div>
            );
          })}
        </>
      ) : (
        portrait ? (
          // Shifted left by half a card so the seam falls between two cards, not through one.
          <div style={{ position: "absolute", left: -W * 0.64, width: W * 2.65, top: cardsTop, height: H - cardsTop }}>
            <DnaCarousel
              images={pair.screens.map((n) => ({ src: shotUrl(n, theme), alt: n }))}
              itemWidth={itemW}
              itemHeight={itemH}
              radius={itemW * 0.113}
              autoplay={false}
              wheel={false}
              blur={0}
              depth={itemW * 0.63}
              spread={itemW * 0.145}
              curve={9}
              rotation={22}
              tilt={0}
              inactiveScale={0.82}
              inactiveOpacity={1}
              shadowStrength={theme === "light" ? 0.16 : 0.5}
              visibleItems={4.2}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          <Fan screens={pair.screens} theme={theme} W={W} top={cardsTop} height={H - cardsTop} aspect={CARD[pair.kind]} />
        )
      )}
    </AbsoluteFill>
  );
};
