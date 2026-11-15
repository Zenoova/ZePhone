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
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" source="rx" />);
    await waitFor(() => expect(orb()).toHaveAttribute("data-orb", "shdr-11"));
    expect(orb()).toHaveAttribute("data-state", "idle");
  });

  it("is restless while the other party is being reached", () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" source="rx" waiting />);
    expect(orb()).toHaveAttribute("data-state", "thinking");
  });

  it("speaks with the real audio level, and calms down shortly after it stops", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" source="rx" />);
    pushLevel("c1", false, -20, performance.now());
    await run(200);
    expect(orb()).toHaveAttribute("data-state", "speaking");
    // No more reports: the level goes stale (450 ms), fades out, and the orb holds a moment before resting.
    await run(2200);
    expect(orb()).toHaveAttribute("data-state", "idle");
  });

  it("listens to the microphone for our own orb, not to the remote voice", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" source="tx" />);
    pushLevel("c1", false, -20, performance.now()); // remote voice only
    await run(300);
    expect(orb()).toHaveAttribute("data-state", "idle");
    pushLevel("c1", true, -20, performance.now()); // our voice
    await run(200);
    expect(orb()).toHaveAttribute("data-state", "speaking");
  });

  it("stays calm and grey when the microphone is muted, whatever the level", async () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="c1" source="tx" muted />);
    pushLevel("c1", true, -10, performance.now());
    await run(300);
    expect(orb()).toHaveAttribute("data-state", "idle");
    expect(orb()).toHaveClass("grayscale");
  });

  it("always shows the speaking look in a preview", () => {
    render(<ShaderVoiceOrb orb="shdr-11" callId="" source="rx" demo />);
    expect(orb()).toHaveAttribute("data-state", "speaking");
  });
});
