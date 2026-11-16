import { describe, expect, it } from "vitest";

import { clock, linePath, niceAxis } from "./chart-math";

describe("niceAxis", () => {
  it("counts in round steps, up to five of them", () => {
    expect(niceAxis(4, 4)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceAxis(5, 4)).toEqual({ top: 5, ticks: [0, 1, 2, 3, 4, 5] });
    expect(niceAxis(6, 4)).toEqual({ top: 6, ticks: [0, 2, 4, 6] });
    expect(niceAxis(33, 20)).toEqual({ top: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceAxis(50, 50)).toEqual({ top: 50, ticks: [0, 10, 20, 30, 40, 50] });
    expect(niceAxis(100, 100)).toEqual({ top: 100, ticks: [0, 20, 40, 60, 80, 100] });
  });

  it("never ends below the floor, however calm the data", () => {
    expect(niceAxis(2, 100).top).toBe(100);
    expect(niceAxis(0, 16).top).toBe(20);
  });

  it("scales to large and small values", () => {
    expect(niceAxis(1234, 100).top).toBe(1500);
    expect(niceAxis(0.7, 0.1).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });
});

describe("clock", () => {
  it("writes seconds as m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59.6)).toBe("1:00");
    expect(clock(125)).toBe("2:05");
    expect(clock(-3)).toBe("0:00");
  });
});

describe("linePath", () => {
  const id = (n: number) => n;
  it("draws one stroke through the points", () => {
    expect(
      linePath(
        [
          [0, 1],
          [1, 2],
          [2, 3],
        ],
        id,
        id,
      ),
    ).toBe("M0.0 1.0L1.0 2.0L2.0 3.0");
  });

  it("lifts the pen where a value is missing", () => {
    expect(
      linePath(
        [
          [0, 1],
          [1, null],
          [2, 3],
          [3, 4],
        ],
        id,
        id,
      ),
    ).toBe("M0.0 1.0M2.0 3.0L3.0 4.0");
  });
});
