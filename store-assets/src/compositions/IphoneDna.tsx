import { AbsoluteFill, staticFile } from "remotion";
import { DnaCarousel } from "../components/dna-carousel";
import { font, palette, type Theme } from "../theme";
import { FxLayer } from "./FxLayer";
import { iconUrl } from "./parts";
import { usePreload } from "./usePreload";

/** Real screens of the app, in the order the helix shows them around the centre card. */
const screens = ["phone-call-active", "phone-recordings", "phone-call-incoming", "phone-accounts", "phone-history", "phone-directory"];

export const IPHONE_PANORAMA = { width: 2640, height: 2868 };

/**
 * The two first App Store screenshots in one picture (2 × 1320 px): the helix of screens runs across the seam, so side by side
 * on the product page they read as one. `scripts/render-all.mjs` cuts the render in two. The title has one line per picture, and
 * the Icon Composer icon sits above the first one.
 */
export const IphoneDna = ({ theme = "light" }: { theme?: Theme }) => {
  const p = palette(theme);
  usePreload([...screens.map((n) => staticFile(`${n}-${theme}.png`)), iconUrl(theme, "ios")]);
  const line = { position: "absolute" as const, top: 470, width: 1320, textAlign: "center" as const, fontSize: 196, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1 };
  return (
    <AbsoluteFill style={{ background: p.bg, fontFamily: font, color: p.ink }}>
      <FxLayer origin={[0.5, 0.58]} cell={4} color={p.dots} />
      <img src={iconUrl(theme, "ios")} style={{ position: "absolute", display: "block", left: 660 - 140, top: 150, width: 280, height: 280 }} />
      {/* One line of the title per screenshot: each reads on its own, and together they read as one sentence. */}
      <div style={{ ...line, left: 0 }}>Your SIP line,</div>
      <div style={{ ...line, left: 1320, color: p.muted }}>on iPhone.</div>
      {/* Shifted left by half a card so the seam falls between two cards, not through one. */}
      <div style={{ position: "absolute", left: -845, width: 3500, top: 720, height: 2160 }}>
        <DnaCarousel
          images={screens.map((n) => ({ src: staticFile(`${n}-${theme}.png`), alt: n }))}
          itemWidth={760}
          itemHeight={1500}
          radius={86}
          autoplay={false}
          wheel={false}
          blur={0}
          depth={480}
          spread={110}
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
    </AbsoluteFill>
  );
};
