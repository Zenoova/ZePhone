import { beforeEach, describe, expect, it } from "vitest";

import { STALE_MS, clearLevels, dbToLevel, getLevel, pushLevel } from "./audio-levels";

beforeEach(() => clearLevels());

describe("dbToLevel", () => {
  it("is 0 for silence and 1 near full scale, and increases monotonically", () => {
    expect(dbToLevel(-96)).toBe(0);
    expect(dbToLevel(-58)).toBe(0);
    expect(dbToLevel(-12)).toBe(1);
    expect(dbToLevel(0)).toBe(1);
    let prev = -1;
    for (let db = -60; db <= -12; db += 4) {
      const l = dbToLevel(db);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it("gives speech levels a clearly visible value", () => {
    expect(dbToLevel(-25)).toBeGreaterThan(0.5);
    expect(dbToLevel(-45)).toBeGreaterThan(0.1);
  });
});

describe("levels store", () => {
  it("keeps one level per call and direction", () => {
    pushLevel("a", false, -20, 1000);
    pushLevel("a", true, -50, 1000);
    pushLevel("b", false, -96, 1000);
    expect(getLevel("a", "rx", 1100)).toBeCloseTo(dbToLevel(-20));
    expect(getLevel("a", "tx", 1100)).toBeCloseTo(dbToLevel(-50));
    expect(getLevel("b", "rx", 1100)).toBe(0);
    expect(getLevel("zzz", "rx", 1100)).toBe(0);
  });

  it("falls silent when reports stop (hold, end of call, lost stream)", () => {
    pushLevel("a", false, -20, 1000);
    expect(getLevel("a", "rx", 1000 + STALE_MS - 1)).toBeGreaterThan(0);
    expect(getLevel("a", "rx", 1000 + STALE_MS + 1)).toBe(0);
  });

  it("forgets a finished call", () => {
    pushLevel("a", false, -20, 1000);
    clearLevels("a");
    expect(getLevel("a", "rx", 1000)).toBe(0);
  });
});
