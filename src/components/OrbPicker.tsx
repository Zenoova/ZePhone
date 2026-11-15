import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";

import { ShaderVoiceOrb } from "@/components/ShaderVoiceOrb";
import { VOICE_ORBS, findVoiceOrb } from "@/lib/voice-orbs";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

/** Diameter of the orb in the middle, in px. */
const SIZE = 104;
/** Distance between the centres of two neighbours, in px. */
const SLOT = 88;
/** Orbs drawn on each side of the middle one (the outer one only peeks in at the edge). */
const REACH = 2;
const OFFSETS = Array.from({ length: REACH * 2 + 1 }, (_, i) => i - REACH);
/** Scale and opacity by distance from the middle. */
const SCALE = [1, 0.56, 0.4];
const OPACITY = [1, 0.6, 0.28];
/** The choice is saved (and applied to the call screen) once the carousel has rested for this long. */
const SETTLE_MS = 250;
/** Horizontal scroll needed for one step, and the pause after a step (trackpad inertia). */
const WHEEL_STEP = 50;
const WHEEL_COOLDOWN_MS = 180;
/** A pointer drag shorter than this is a click. */
const DRAG_MIN = 24;

const mod = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Choose the voice orb: a horizontal carousel with the chosen orb alive in the middle and its name under it.
 * Click a neighbour, swipe, scroll or use the arrow keys; the choice applies to the call screen and the logo
 * once the carousel stops, and is remembered.
 */
export function OrbPicker() {
  const stored = findVoiceOrb(useSettingsStore((s) => s.settings.general.voiceOrb)).id;
  const update = useSettingsStore((s) => s.update);
  const count = VOICE_ORBS.length;

  const [index, setIndex] = useState(() => VOICE_ORBS.findIndex((o) => o.id === stored));
  const indexRef = useRef(index);
  const timer = useRef<number | null>(null);
  const savedId = useRef(stored);
  const wheel = useRef({ acc: 0, until: 0 });
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const current = VOICE_ORBS[index]!;

  const save = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const id = VOICE_ORBS[indexRef.current]!.id;
    if (id === savedId.current) return;
    savedId.current = id;
    void update({ general: { voiceOrb: id } });
  };

  const step = (delta: number) => {
    indexRef.current = mod(indexRef.current + delta, count);
    setIndex(indexRef.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SETTLE_MS);
  };

  // Closing the popover right after a swipe must not lose the choice.
  const flush = useRef(save);
  useEffect(() => {
    flush.current = save;
  });
  useEffect(() => () => flush.current(), []);

  const onKeyDown = (e: KeyboardEvent) => {
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : e.key === "Home"
            ? -indexRef.current
            : e.key === "End"
              ? count - 1 - indexRef.current
              : 0;
    if (to === 0) return;
    e.preventDefault();
    step(to);
  };

  const onWheel = (e: WheelEvent) => {
    const w = wheel.current;
    const now = e.timeStamp;
    if (now < w.until) return;
    w.acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(w.acc) < WHEEL_STEP) return;
    step(Math.sign(w.acc));
    w.acc = 0;
    w.until = now + WHEEL_COOLDOWN_MS;
  };

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, moved: false };
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < DRAG_MIN) return;
    // Swiping left brings the orbs on the right to the middle.
    step(-Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / SLOT)));
    drag.current = { x: 0, moved: true }; // swallow the click that follows the swipe
  };

  const onPick = (offset: number) => {
    if (drag.current?.moved) {
      drag.current = null;
      return;
    }
    if (offset !== 0) step(offset);
  };

  return (
    <div className="flex flex-col items-center gap-2" data-testid="orb-picker">
      <div
        role="radiogroup"
        aria-label="Voice orb"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        className={cn(
          "focus-visible:ring-ring/50 relative w-full touch-pan-y overflow-hidden rounded-xl outline-none select-none focus-visible:ring-[3px]",
          "[mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]",
        )}
        style={{ height: SIZE + 8 }}
      >
        {OFFSETS.map((offset) => {
          const orb = VOICE_ORBS[mod(index + offset, count)]!;
          const away = Math.abs(offset);
          return (
            <button
              key={orb.id}
              type="button"
              role="radio"
              aria-checked={offset === 0}
              aria-label={orb.label}
              tabIndex={-1}
              onClick={() => onPick(offset)}
              className="absolute top-1 left-1/2 block cursor-pointer rounded-full outline-none transition-[transform,opacity] duration-300 ease-out"
              style={{
                width: SIZE,
                height: SIZE,
                marginLeft: -SIZE / 2,
                transform: `translateX(${offset * SLOT}px) scale(${SCALE[away]})`,
                opacity: OPACITY[away],
              }}
            >
              <ShaderVoiceOrb orb={orb.id} callId="" demo still={offset !== 0} />
            </button>
          );
        })}
      </div>
      <p className="text-sm font-medium" aria-live="polite" data-testid="orb-name">
        {current.label}
      </p>
    </div>
  );
}
