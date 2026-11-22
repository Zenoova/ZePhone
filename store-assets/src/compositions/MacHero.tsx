import { AbsoluteFill, staticFile } from "remotion";
import { MacbookMockup } from "../components/mockups/macbook-mockup";
import { colors, font } from "../theme";
import { FxLayer } from "./FxLayer";

const W = 2880;
const H = 1800;

export const MacHero = ({ screen = "mac-history-light" }: { screen?: string }) => (
  <AbsoluteFill style={{ background: colors.background, fontFamily: font, color: colors.ink }}>
    <FxLayer origin={[0.5, 0.78]} />
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center" }}>
      <div style={{ fontSize: 138, fontWeight: 600, letterSpacing: -5, lineHeight: 1.02 }}>Your SIP line, on your Mac.</div>
      <div style={{ fontSize: 56, fontWeight: 400, color: colors.muted, marginTop: 34, letterSpacing: -1 }}>
        Bring your own server. No account, no ads.
      </div>
    </div>
    <div style={{ position: "absolute", left: (W - 2000) / 2, top: 540, width: 2000 }}>
      <MacbookMockup expandable={false} frameSrc={staticFile("macbook-frame.webp")}>
        <img src={staticFile(`${screen}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      </MacbookMockup>
    </div>
  </AbsoluteFill>
);

export const macHeroSize = { width: W, height: H };
