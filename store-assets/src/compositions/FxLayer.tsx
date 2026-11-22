import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { DitherCanvas } from "../components/shad-fx/dither";
import { useFx } from "../components/shad-fx/use-fx";
import { rings } from "../components/shad-fx/effects/rings";

/**
 * A faint dithered sonar (shad-fx "rings") in light grey behind a device: the only decoration of a picture.
 * The effect runs on the clock of the page, so the render waits a moment for the rings to spread out.
 */
export const FxLayer = ({ origin = [0.5, 0.55] as [number, number], cell = 4, color = [205, 205, 205] as [number, number, number] }) => {
  const fx = useFx(rings, { color, origin, interval: 1.3, speed: 0.3, width: 2.4 });
  const [handle] = useState(() => delayRender("shad-fx rings"));
  useEffect(() => {
    const t = setTimeout(() => continueRender(handle), 4200);
    return () => clearTimeout(t);
  }, [handle]);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <DitherCanvas effect={fx} cell={cell} />
    </div>
  );
};
