import { useEffect, useRef, useState } from "react";

import type { VoiceOrbProps } from "@/components/ClassicVoiceOrb";
import { type OrbState, type OrbVariant, ShaderOrb } from "@/components/orbs/orbkit-core";
import { type LevelSource, getLevel } from "@/lib/audio-levels";
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
  const [loaded, setLoaded] = useState<{ id: string; variant: OrbVariant | null } | null>(null);
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
 * The real voice of the call as a 0…1 level (fast attack, slow release, like the classic orb) and a
 * "speaking" flag with hysteresis. Read every animation frame, but only pushed into React when it changes
 * noticeably, ~30 times a second at most.
 */
function useVoiceSignal(callId: string, source: LevelSource, flat: boolean): Signal {
  const [signal, setSignal] = useState<Signal>({ speaking: false, level: 0 });
  const live = useRef({ callId, source, flat });
  useEffect(() => {
    live.current = { callId, source, flat };
  });

  useEffect(() => {
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
      const p = live.current;
      const target = p.flat ? 0 : getLevel(p.callId, p.source, now);
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
  }, []);

  return signal;
}

interface ShaderVoiceOrbProps extends VoiceOrbProps {
  /** Id of the OrbKit orb (see `VOICE_ORBS`). */
  orb: string;
  /** Previews: always show the "speaking" look, whatever the call. */
  demo?: boolean;
}

/**
 * An OrbKit shader orb standing for one voice of the call. Its state follows the conversation — restless
 * while the other party is being reached, calm at rest, bright and fast while the voice is there — and the
 * real audio level (from Baresip) drives the shader's volume uniforms, so it moves with the actual sound.
 */
export function ShaderVoiceOrb({ orb, callId, source, muted, paused, waiting, demo, className }: ShaderVoiceOrbProps) {
  const variant = useOrbVariant(orb);
  const flat = Boolean(muted || paused);
  const { speaking, level } = useVoiceSignal(callId, source, flat);

  const state: OrbState = demo ? "speaking" : flat ? "idle" : speaking ? "speaking" : waiting ? "thinking" : "idle";
  const heard = !demo && !flat && level > 0.03;

  return (
    <div
      data-testid="shader-orb"
      data-orb={orb}
      data-state={state}
      className={cn(
        "size-full transition-[filter,opacity] duration-300",
        muted && "opacity-60 grayscale",
        paused && !muted && "opacity-50",
        className,
      )}
    >
      {variant && (
        <ShaderOrb
          variant={variant}
          state={state}
          className="size-full"
          // Only pinned while there is real sound: at rest the orb keeps its own slow breathing.
          volumes={heard ? { input: level, output: level } : undefined}
          paused={Boolean(paused)}
          maxDpr={1.5}
        />
      )}
    </div>
  );
}
