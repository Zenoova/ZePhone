import { AbsoluteFill, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Geist";
import { LaptopFrame } from "../components/snap-cn/laptop-frame";
import { Backdrop } from "./Backdrop";

const { fontFamily } = loadFont("normal", { weights: ["500", "700"], subsets: ["latin"] });

export const MacHero = () => (
  <AbsoluteFill style={{ fontFamily, color: "white" }}>
    <Backdrop width={2880} height={1800} />
    <AbsoluteFill style={{ transform: "translateY(310px)" }}>
      <LaptopFrame screenSrc={staticFile("mac-history.png")} entrance="none" floatLoop={false} scale={2.75} mode="dark" restTilt={10} />
    </AbsoluteFill>
    <div style={{ position: "absolute", top: 110, left: 0, right: 0, textAlign: "center" }}>
      <div style={{ fontSize: 150, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>Your SIP line.</div>
      <div style={{ fontSize: 150, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02, opacity: 0.72 }}>On your Mac.</div>
    </div>
  </AbsoluteFill>
);
