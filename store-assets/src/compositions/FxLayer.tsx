import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { DitherCanvas } from "../components/shad-fx/dither";
import { useFx } from "../components/shad-fx/use-fx";
import { rings } from "../components/shad-fx/effects/rings";

/**
 * The dithered sonar of shad-fx ("rings") behind every picture: rings pulsing out of a point, in the grey of the theme.
 * The effect runs on the clock of the page, so the render waits a moment for the rings to spread out.
 * `origin` is where the rings start, as fractions of the picture; `cell` is the size of a dot.
 */
export const FxLayer = ({
  origin = [0.5, 0.55] as [number, number],
  cell = 4,
  color = [190, 190, 198] as [number, number, number],
  width = 2.8,
  interval = 1.2,
}) => {
  const fx = useFx(rings, { color, origin, interval, speed: 0.26, width });
  const [handle] = useState(() => delayRender("shad-fx rings"));
  useEffect(() => {
    const t = setTimeout(() => continueRender(handle), 4800);
    return () => clearTimeout(t);
  }, [handle]);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* No ceiling on the grid: a capped one stretches the cells, and the rings come out as ellipses. */}
      <DitherCanvas effect={fx} cell={cell} maxCols={4000} maxRows={4000} />
    </div>
  );
};
