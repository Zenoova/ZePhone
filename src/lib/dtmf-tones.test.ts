import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DTMF_FREQUENCIES, dtmfFrequencies, playDtmfTone, resetDtmfAudio } from "./dtmf-tones";

describe("DTMF frequency table", () => {
  it("matches the standard keypad grid", () => {
    expect(dtmfFrequencies("1")).toEqual([697, 1209]);
    expect(dtmfFrequencies("5")).toEqual([770, 1336]);
    expect(dtmfFrequencies("9")).toEqual([852, 1477]);
    expect(dtmfFrequencies("0")).toEqual([941, 1336]);
    expect(dtmfFrequencies("*")).toEqual([941, 1209]);
    expect(dtmfFrequencies("#")).toEqual([941, 1477]);
    expect(dtmfFrequencies("d")).toEqual([941, 1633]);
  });

  it("uses the four standard low and four high frequencies, each key a unique pair", () => {
    const pairs = Object.values(DTMF_FREQUENCIES);
    expect(pairs).toHaveLength(16);
    expect(new Set(pairs.map(([l]) => l))).toEqual(new Set([697, 770, 852, 941]));
    expect(new Set(pairs.map(([, h]) => h))).toEqual(new Set([1209, 1336, 1477, 1633]));
    expect(new Set(pairs.map((p) => p.join("/"))).size).toBe(16);
  });

  it("has no tone for other characters", () => {
    expect(dtmfFrequencies("+")).toBeNull();
    expect(dtmfFrequencies("x")).toBeNull();
  });
});

describe("playDtmfTone", () => {
  const oscillators: Array<{ frequency: { setValueAtTime: ReturnType<typeof vi.fn> }; start: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    oscillators.length = 0;
    resetDtmfAudio();
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      }
      createOscillator() {
        const osc = {
          type: "",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(osc);
        return osc;
      }
      resume = vi.fn();
    }
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDtmfAudio();
  });

  it("starts exactly the two oscillators of the key", () => {
    playDtmfTone("7");
    expect(oscillators).toHaveLength(2);
    expect(oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0]?.[0])).toEqual([852, 1209]);
    expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true);
  });

  it("ignores keys without a tone", () => {
    playDtmfTone("+");
    expect(oscillators).toHaveLength(0);
  });

  it("never throws when Web Audio is unavailable", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("AudioContext", undefined);
    resetDtmfAudio();
    expect(() => playDtmfTone("1")).not.toThrow();
  });
});
