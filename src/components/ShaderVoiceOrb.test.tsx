import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShaderVoiceOrb } from "@/components/ShaderVoiceOrb";
import { clearLevels, pushLevel } from "@/lib/audio-levels";

const orb = () => screen.getByTestId("shader-orb");

/** Lets the animation loop (requestAnimationFrame) and the 33 ms throttle run for `ms`. */
async function run(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  clearLevels();
});

describe("ShaderVoiceOrb", () => {
  it("loads its shader and rests while nobody speaks", async () => {
    vi.useRealTimers();
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" />);
    await waitFor(() => expect(orb()).toHaveAttribute("data-orb", "shdr-11"));
    expect(orb()).toHaveAttribute("data-state", "idle");
  });

  it("is restless while the other party is being reached", () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" waiting />);
    expect(orb()).toHaveAttribute("data-state", "thinking");
  });

  it("speaks with the real audio level, and calms down shortly after it stops", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" />);
    pushLevel("c1", false, -20, performance.now());
    await run(200);
    expect(orb()).toHaveAttribute("data-state", "speaking");
    // No more reports: the level goes stale (450 ms), fades out, and the orb holds a moment before resting.
    await run(2200);
    expect(orb()).toHaveAttribute("data-state", "idle");
  });

  it("ignores the level of other calls", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" />);
    pushLevel("c2", false, -20, performance.now());
    pushLevel("c1", true, -20, performance.now()); // our own microphone is not the voice we show
    await run(300);
    expect(orb()).toHaveAttribute("data-state", "idle");
  });

  it("is calm and dimmed when the call is on hold, whatever the level", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" paused />);
    pushLevel("c1", false, -10, performance.now());
    await run(300);
    expect(orb()).toHaveAttribute("data-state", "idle");
    expect(orb()).toHaveClass("opacity-50");
  });

  it("always shows the speaking look in a preview", () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="" demo />);
    expect(orb()).toHaveAttribute("data-state", "speaking");
  });
});
