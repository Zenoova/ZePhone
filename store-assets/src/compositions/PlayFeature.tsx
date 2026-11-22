import { AbsoluteFill, Img, staticFile } from "remotion";
import { Android } from "../components/mockups/android";
import { colors, font } from "../theme";
import { FxLayer } from "./FxLayer";
import { usePreload } from "./usePreload";

/** Google Play's feature graphic (1024 × 500), drawn at twice the size (2048 × 1000) and scaled down. */
export const PLAY_FEATURE = { width: 2048, height: 1000 };

export const PlayFeature = () => {
  usePreload([staticFile("phone-call-active-light.png"), staticFile("phone-history-light.png")]);
  return (
    <AbsoluteFill style={{ background: colors.background, fontFamily: font, color: colors.ink }}>
      <FxLayer origin={[0.76, 0.6]} cell={4} />
      <div style={{ position: "absolute", left: 150, top: 0, bottom: 0, width: 1000, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150, marginLeft: -18, filter: "brightness(0)" }} />
        <div style={{ fontSize: 176, fontWeight: 600, letterSpacing: -7, lineHeight: 1, marginTop: 18 }}>ZePhone</div>
        <div style={{ fontSize: 64, fontWeight: 400, color: colors.muted, letterSpacing: -1.5, lineHeight: 1.12, marginTop: 28 }}>
          The SIP softphone
          <br />
          for your own line.
        </div>
      </div>
      {/* The phone rises from the bottom edge: its lower part is cropped, like the rest of the pictures. */}
      <div style={{ position: "absolute", left: 1170, top: 120, width: 400, transform: "rotate(-4deg)" }}>
        <Android width={433} height={882} src={staticFile("phone-call-active-light.png")} style={{ width: 400, height: "auto", filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.12))" }} />
      </div>
      <div style={{ position: "absolute", left: 1560, top: 300, width: 400, transform: "rotate(3deg)" }}>
        <Android width={433} height={882} src={staticFile("phone-history-light.png")} style={{ width: 400, height: "auto", filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.12))" }} />
      </div>
    </AbsoluteFill>
  );
};
