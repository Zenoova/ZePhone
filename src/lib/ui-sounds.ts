import { getAudioContext, playNote } from "./web-audio";

/**
 * Short two-note cue when the microphone is muted (falling) or unmuted (rising), like the iPhone's.
 * Played through the webview's audio output (the system default output device).
 */
export function playMuteSound(muted: boolean): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const [first, second] = muted ? [784, 523] : [523, 784]; // G5 -> C5 / C5 -> G5
    const t0 = ctx.currentTime + 0.005;
    playNote(ctx, first, t0, 0.075, { type: "triangle", gain: 0.09 });
    playNote(ctx, second, t0 + 0.085, 0.11, { type: "triangle", gain: 0.09 });
  } catch {
    /* a cue is a nicety */
  }
}
