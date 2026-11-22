import { MeshGradient } from "@paper-design/shaders-react";
import type { CSSProperties } from "react";

/** The brand backdrop: the blue → violet → rose of the app, as a soft mesh gradient with a little grain. */
export const Backdrop = ({ width, height, offset = 0, style }: { width: number; height: number; offset?: number; style?: CSSProperties }) => (
  <MeshGradient
    width={width}
    height={height}
    colors={["#1b1464", "#4f2bb0", "#8a3fd0", "#e0558f", "#2a6df4"]}
    distortion={0.9}
    swirl={0.55}
    speed={0}
    frame={4200 + offset}
    style={{ position: "absolute", inset: 0, ...style }}
  />
);
