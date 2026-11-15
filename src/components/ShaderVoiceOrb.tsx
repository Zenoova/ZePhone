import { useEffect, useState } from "react";

import { type OrbState, type OrbVariant, ShaderOrb } from "@/components/orbs/orbkit-core";
import { getLevel } from "@/lib/audio-levels";
import { cn } from "@/lib/utils";
import { loadOrbVariant } from "@/lib/voice-orbs";

/** The orb switches to "speaking" above this smoothed level… */
const SPEAKING_ON = 0.08;
/** …and goes back to rest once it has stayed under this one for `SPEAKING_HOLD_MS` (no flapping between words). */
const SPEAKING_OFF = 0.04;
const SPEAKING_HOLD_MS = 450;
/** The WebGL props are refreshed at most this often: the shader itself still runs at the display rate. */
const SIGNAL_EVERY_MS = 33;

/** Loads the shader of an orb (a separate chunk) the first time it is needed. */
function useOrbVariant(id: string): OrbVariant | null {
  const [loaded, setLoaded] = useState<{ id: string; variant: OrbVariant } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadOrbVariant(id)
      .then((variant) => !cancelled && setLoaded({ id, variant }))
      .catch(() => {
        /* a missing chunk leaves the orb blank rather than breaking the call screen */
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return loaded?.id === id ? loaded.variant : null;
}

interface Signal {
  speaking: boolean;
  level: number;
}

/**
 * The remote voice of the call as a 0…1 level (fast attack, slow release) and a "speaking" flag with
 * hysteresis. Read every animation frame, but only pushed into React when it changes noticeably, ~30 times a
 * second at most. Does nothing while `active` is false.
 */
function useVoiceSignal(callId: string, active: boolean): Signal {
  const [signal, setSignal] = useState<Signal>({ speaking: false, level: 0 });

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let level = 0;
    let speaking = false;
    let loudAt = 0;
    let sent: Signal = { speaking: false, level: 0 };
    let sentAt = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = getLevel(callId, "rx", now);
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.045 : 0.2)));

      if (level > SPEAKING_ON) {
        speaking = true;
        loudAt = now;
      } else if (speaking && level > SPEAKING_OFF) {
        loudAt = now;
      } else if (speaking && now - loudAt > SPEAKING_HOLD_MS) {
        speaking = false;
      }

      if (now - sentAt >= SIGNAL_EVERY_MS && (speaking !== sent.speaking || Math.abs(level - sent.level) > 0.015)) {
        sent = { speaking, level };
        sentAt = now;
        setSignal(sent);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [callId, active]);

  return signal;
}

export interface ShaderVoiceOrbProps {
  /** Id of the OrbKit orb (see `VOICE_ORBS`). */
  orb: string;
  /** The call whose remote voice drives the orb; "" for none. */
  callId: string;
  /** Call on hold or ended: dimmed and frozen. */
  paused?: boolean;
  /** Waiting for the other party (ringing, connecting): the orb turns restless. */
  waiting?: boolean;
  /** Previews: always the "speaking" look, whatever the call. */
  demo?: boolean;
  /** Frozen on one frame, without being dimmed (the neighbours in the picker). */
  still?: boolean;
  className?: string;
}

/**
 * An OrbKit shader orb standing for the voice of the person we talk to. Its state follows the conversation —
 * restless while the other party is being reached, calm at rest, bright and fast while the voice is there —
 * and the real audio level (from Baresip) drives the shader's volume uniforms, so it moves with the actual sound.
 */
export function ShaderVoiceOrb({ orb, callId, paused, waiting, demo, still, className }: ShaderVoiceOrbProps) {
  const variant = useOrbVariant(orb);
  const { speaking, level } = useVoiceSignal(callId, !demo && !still && !paused);

  const state: OrbState = demo ? "speaking" : paused ? "idle" : speaking ? "speaking" : waiting ? "thinking" : "idle";
  const heard = !demo && !paused && level > 0.03;

  return (
    <div
      data-testid="shader-orb"
      data-orb={orb}
      data-state={state}
      className={cn("size-full transition-opacity duration-300", paused && "opacity-50", className)}
    >
      {variant && (
        <ShaderOrb
          variant={variant}
          state={state}
          className="size-full"
          // Only pinned while there is real sound: at rest the orb keeps its own slow breathing.
          volumes={heard ? { input: level, output: level } : undefined}
          paused={Boolean(paused || still)}
          maxDpr={1.5}
        />
      )}
    </div>
  );
}
