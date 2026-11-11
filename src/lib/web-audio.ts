/** One shared Web Audio context for the app's own UI sounds (keypad tones, mute/unmute cues). */

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (context) return context;
  const Ctor: AudioContextCtor | undefined =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Forgets the shared context (tests). */
export function resetAudioContext(): void {
  context = null;
}

/**
 * Plays one note with a short attack/release so it never clicks.
 * `type`/`gain` shape the timbre; everything is wrapped so a broken audio stack never breaks the UI.
 */
export function playNote(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  durationS: number,
  { type = "sine", gain = 0.1 }: { type?: OscillatorType; gain?: number } = {},
): void {
  const g = ctx.createGain();
  const attack = 0.006;
  const release = Math.min(0.03, durationS / 2);
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(gain, startAt + attack);
  g.gain.setValueAtTime(gain, Math.max(startAt + attack, startAt + durationS - release));
  g.gain.linearRampToValueAtTime(0, startAt + durationS);
  g.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startAt);
  osc.connect(g);
  osc.start(startAt);
  osc.stop(startAt + durationS + 0.01);
}
