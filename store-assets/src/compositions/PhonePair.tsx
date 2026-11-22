import { AbsoluteFill, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Geist";
import { PhoneFrame } from "../components/snap-cn/phone-frame";
import { Backdrop } from "./Backdrop";

const { fontFamily } = loadFont("normal", { weights: ["500", "700"], subsets: ["latin"] });

/**
 * Two App Store screenshots in one canvas (2 × 1320 px): the title and the backdrop run across the seam, so side by side
 * on the product page they read as one picture. `scripts/split.mjs` cuts the render in two.
 */
export const PhonePair = () => (
  <AbsoluteFill style={{ fontFamily, color: "white" }}>
    <Backdrop width={2640} height={2868} offset={600} />
    <div style={{ position: "absolute", top: 190, left: 0, right: 0, textAlign: "center" }}>
      <div style={{ fontSize: 250, fontWeight: 700, letterSpacing: -8, lineHeight: 1 }}>Your line,</div>
      <div style={{ fontSize: 250, fontWeight: 700, letterSpacing: -8, lineHeight: 1, opacity: 0.7 }}>your rules.</div>
    </div>
    {/* The frame is as big as the composition and centres its phone: one wrapper per phone. */}
    <div style={{ position: "absolute", left: 0, top: 600, width: 1320, height: 2868, transform: "translateX(-30px)" }}>
      <PhoneFrame variant="tilt" tiltAngle={-14} entrance="float" floatLoop={false} scale={3.3} mode="dark" screenSrc={staticFile("phone-call-incoming.png")} />
    </div>
    <div style={{ position: "absolute", left: 1320, top: 600, width: 1320, height: 2868, transform: "translateX(30px)" }}>
      <PhoneFrame variant="tilt" tiltAngle={14} entrance="float" floatLoop={false} scale={3.3} mode="dark" screenSrc={staticFile("phone-call-active.png")} />
    </div>
  </AbsoluteFill>
);
