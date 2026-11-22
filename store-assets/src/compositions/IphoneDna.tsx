import { AbsoluteFill, staticFile } from "remotion";
import { DnaCarousel } from "../components/dna-carousel";
import { colors, font } from "../theme";
import { FxLayer } from "./FxLayer";
import { usePreload } from "./usePreload";

// The carousel was written for Tailwind: Remotion's bundler now has it (src/index.css), no extra CSS needed.

/** Real screens of the app (light theme), in the order the helix shows them around the centre card. */
const screens = ["phone-call-active", "phone-recordings", "phone-call-incoming", "phone-settings", "phone-history", "phone-dialer"];

export const IPHONE_PANORAMA = { width: 2640, height: 2868 };

/**
 * Two App Store screenshots in one picture (2 × 1320 px): the helix of screens runs across the seam, so side by side on
 * the product page they read as one. `scripts/split.mjs` cuts the render in two.
 */
export const IphoneDna = ({ theme = "light" }: { theme?: "light" | "dark" }) => {
  usePreload(screens.map((n) => staticFile(`${n}-${theme}.png`)));
  return (
  <AbsoluteFill style={{ background: colors.background, fontFamily: font, color: colors.ink }}>
    <FxLayer origin={[0.5, 0.58]} cell={5} />
    {/* One line of the title per screenshot: each reads on its own, and together they read as one sentence. */}
    <div style={{ position: "absolute", top: 330, left: 0, width: 1320, textAlign: "center", fontSize: 196, fontWeight: 600, letterSpacing: -8, lineHeight: 1 }}>Your SIP line,</div>
    <div style={{ position: "absolute", top: 330, left: 1320, width: 1320, textAlign: "center", fontSize: 196, fontWeight: 600, letterSpacing: -8, lineHeight: 1, color: colors.muted }}>on iPhone.</div>
    {/* Shifted left by half a card so the seam falls between two cards, not through one. */}
    <div style={{ position: "absolute", left: -845, width: 3500, top: 640, height: 2160 }}>
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
        shadowStrength={0.16}
        visibleItems={4.2}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  </AbsoluteFill>
  );
};
