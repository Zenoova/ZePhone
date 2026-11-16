/**
 * The vertical axis of a chart: round steps (1, 2 or 5 times a power of ten), at most five of them, from zero up to
 * the first step at or above `max` (and never below `floor`).
 */
export function niceAxis(max: number, floor: number): { top: number; ticks: number[] } {
  const want = Math.max(max, floor, 1e-9);
  for (let pow = 10 ** Math.floor(Math.log10(want / 5)); ; pow *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * pow;
      if (Math.ceil(want / step - 1e-9) <= 5) {
        const count = Math.max(1, Math.ceil(want / step - 1e-9));
        return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, k) => +(k * step).toPrecision(12)) };
      }
    }
  }
}

/** `m:ss` for a number of seconds. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** SVG path of a line, broken wherever a value is missing. */
export function linePath(points: Array<[number, number | null]>, px: (x: number) => number, py: (v: number) => number) {
  let d = "";
  let pen = false;
  for (const [x, v] of points) {
    if (v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${px(x).toFixed(1)} ${py(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}
