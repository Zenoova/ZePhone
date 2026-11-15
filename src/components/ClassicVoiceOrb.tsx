import { useEffect, useRef } from "react";

import { type LevelSource, getLevel } from "@/lib/audio-levels";
import { cn } from "@/lib/utils";

export type OrbTone = "remote" | "local";

/** Gradient stops (highlight, body, rim) and glow colour per tone. */
const PALETTE: Record<OrbTone | "muted", { stops: [string, string, string]; glow: string }> = {
  remote: { stops: ["#e6e9ff", "#8b94ff", "#4b45e0"], glow: "99,102,241" },
  local: { stops: ["#d5fbf3", "#3fd6c0", "#0f9488"], glow: "45,212,191" },
  muted: { stops: ["#e5e7eb", "#9ca3af", "#6b7280"], glow: "156,163,175" },
};

export interface VoiceOrbProps {
  callId: string;
  /** Whose voice drives the shape: the remote party (`rx`) or our microphone (`tx`). */
  source: LevelSource;
  tone?: OrbTone;
  /** Greys the orb out and flattens it (microphone muted). */
  muted?: boolean;
  /** Call on hold: dimmed and still. */
  paused?: boolean;
  /** Gentle breathing even without sound (ringing, connecting). */
  idle?: boolean;
  /** Livelier idle motion and a bigger body: for small orbs (the sidebar logo) that must read at a glance. */
  vivid?: boolean;
  /** Waiting for the other party (ringing, connecting): the shader orbs turn restless. */
  waiting?: boolean;
  className?: string;
}

const POINTS = 72;

/**
 * ZePhone's own orb: a living blob that swells and ripples with the voice, in the spirit of ChatGPT's voice
 * mode. It reads the live level every animation frame (no React re-render) and smooths it: fast attack, slow
 * release.
 */
export function ClassicVoiceOrb({
  callId,
  source,
  tone = "remote",
  muted,
  paused,
  idle = true,
  vivid,
  className,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Props are read inside the animation loop through a ref so the loop never restarts.
  const live = useRef({ callId, source, tone, muted, paused, idle, vivid });
  useEffect(() => {
    live.current = { callId, source, tone, muted, paused, idle, vivid };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let raf = 0;
    let last = performance.now();
    let level = 0;
    let phase = Math.random() * 10;
    let fade = 1; // 1 = fully lively, lower when paused/muted

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = live.current;
      const flat = p.muted || p.paused;
      const target = flat ? 0 : getLevel(p.callId, p.source, now);
      const k = 1 - Math.exp(-dt / (target > level ? 0.045 : 0.2)); // fast attack, slow release
      level += (target - level) * k;
      fade += ((flat ? 0.55 : 1) - fade) * (1 - Math.exp(-dt / 0.25));
      phase += dt * (flat ? 0.25 : 0.8 + level * 2.4) * (reduceMotion ? 0.3 : 1);
      draw(
        canvas,
        ctx,
        level * (reduceMotion ? 0.4 : 1),
        phase,
        now,
        p.muted ? "muted" : p.tone,
        fade,
        p.idle && !flat,
        Boolean(p.vivid),
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn("block size-full", className)} />;
}

function blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: (a: number) => number) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    const r = radius(a);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  ctx.beginPath();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = pts[0]!;
  const start = mid(pts[POINTS - 1]!, first);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < POINTS; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % POINTS]!);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

function draw(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  level: number,
  phase: number,
  now: number,
  tone: OrbTone | "muted",
  fade: number,
  breathe: boolean,
  vivid: boolean,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const base = (Math.min(w, h) / 2) * (vivid ? 0.68 : 0.6); // leave room for the swell and the glow
  const breath = breathe ? Math.sin(now / 1100) * (vivid ? 0.06 : 0.035) : 0;
  const swell = 1 + level * 0.16 + breath;
  const amp = (vivid ? 0.085 : 0.04) + level * 0.23;
  const { stops, glow } = PALETTE[tone];

  const radiusFor = (offset: number, weight: number) => (a: number) =>
    base *
    swell *
    (1 +
      weight *
        amp *
        (0.6 * Math.sin(2 * a + phase * 1.1 + offset) +
          0.28 * Math.sin(3 * a - phase * 1.6 + offset * 1.7) +
          0.12 * Math.sin(5 * a + phase * 2.1 - offset)));

  ctx.save();
  ctx.globalAlpha = fade;

  // Back layer: a larger, translucent echo with its own rhythm, for depth and glow.
  blobPath(ctx, cx, cy, (a) => radiusFor(2.1, 1.35)(a) * 1.07);
  ctx.fillStyle = `rgba(${glow},${0.16 + level * 0.18})`;
  ctx.shadowColor = `rgba(${glow},${0.35 + level * 0.4})`;
  ctx.shadowBlur = base * (0.35 + level * 0.9);
  ctx.fill();

  // Body.
  blobPath(ctx, cx, cy, radiusFor(0, 1));
  const body = ctx.createRadialGradient(cx - base * 0.3, cy - base * 0.38, base * 0.08, cx, cy, base * 1.25);
  body.addColorStop(0, stops[0]);
  body.addColorStop(0.45, stops[1]);
  body.addColorStop(1, stops[2]);
  ctx.shadowBlur = 0;
  ctx.fillStyle = body;
  ctx.fill();

  // Soft highlight on the upper left.
  blobPath(ctx, cx - base * 0.18, cy - base * 0.24, (a) => radiusFor(4.2, 0.6)(a) * 0.5);
  const shine = ctx.createRadialGradient(
    cx - base * 0.25,
    cy - base * 0.3,
    0,
    cx - base * 0.18,
    cy - base * 0.24,
    base * 0.55,
  );
  shine.addColorStop(0, "rgba(255,255,255,0.55)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fill();

  ctx.restore();
}
