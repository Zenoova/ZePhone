import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playMuteSound } from "./ui-sounds";
import { resetAudioContext } from "./web-audio";

describe("playMuteSound", () => {
  const freqs: number[] = [];

  beforeEach(() => {
    freqs.length = 0;
    resetAudioContext();
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      }
      createOscillator() {
        return {
          type: "",
          frequency: { setValueAtTime: (f: number) => freqs.push(f) },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      resume = vi.fn();
    }
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAudioContext();
  });

  it("falls when muting and rises when unmuting", () => {
    playMuteSound(true);
    expect(freqs).toEqual([784, 523]);
    freqs.length = 0;
    playMuteSound(false);
    expect(freqs).toEqual([523, 784]);
  });

  it("is silent and harmless without Web Audio", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("AudioContext", undefined);
    resetAudioContext();
    expect(() => playMuteSound(true)).not.toThrow();
  });
});
