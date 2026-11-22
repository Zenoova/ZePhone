import { AbsoluteFill, Img, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Geist";
import { DnaCarousel } from "../components/dna-carousel";
import { Backdrop } from "./Backdrop";

const { fontFamily } = loadFont("normal", { weights: ["500", "700"], subsets: ["latin"] });

// The carousel was written for Tailwind: the few utility classes it uses.
const css = `.size-full{width:100%;height:100%}.block{display:block}.object-cover{object-fit:cover}.pointer-events-none{pointer-events:none}.select-none{user-select:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}`;

const cards = ["phone-call-active", "phone-history", "phone-call-incoming", "phone-recordings", "phone-settings", "phone-dialer"].map((n) => ({
  src: staticFile(`${n}.png`),
  alt: n,
}));

/** Google Play's feature graphic (1024 × 500), drawn at twice the size and scaled down. */
export const FeatureGraphic = () => (
  <AbsoluteFill style={{ fontFamily, color: "white" }}>
    <style>{css}</style>
    <Backdrop width={2048} height={1000} offset={1800} />
    <div style={{ position: "absolute", left: 130, top: 270, width: 800 }}>
      <Img src={staticFile("logo.svg")} style={{ width: 210, height: 210, marginLeft: -26, filter: "brightness(0) invert(1)" }} />
      <div style={{ fontSize: 168, fontWeight: 700, letterSpacing: -5, lineHeight: 1, marginTop: 10 }}>ZePhone</div>
      <div style={{ fontSize: 62, fontWeight: 500, opacity: 0.82, lineHeight: 1.15, marginTop: 24 }}>The SIP softphone for your own line.</div>
    </div>
    <div style={{ position: "absolute", right: -40, top: -60, width: 1250, height: 1120 }}>
      <DnaCarousel
        images={cards}
        itemWidth={300}
        itemHeight={650}
        radius={34}
        autoplay={false}
        wheel={false}
        blur={0}
        depth={300}
        spread={90}
        curve={26}
        rotation={20}
        tilt={-8}
        inactiveOpacity={0.9}
        visibleItems={3}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  </AbsoluteFill>
);
