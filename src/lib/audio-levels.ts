/**
 * Live audio levels of the calls, pushed by the backend (`audio:level`, ~16 times a second per direction).
 * Kept outside React state on purpose: the voice animation reads them every frame without re-rendering.
 */

export type LevelSource = "rx" | "tx";

interface Entry {
  rx: number;
  tx: number;
  rxAt: number;
  txAt: number;
}

/** A level older than this is considered silence (reports stop when a call is on hold or ends). */
export const STALE_MS = 450;

const levels = new Map<string, Entry>();

/**
 * Maps dBFS (-96 silence … 0 full scale) to 0…1 for display: speech sits around -35…-12 dBFS, so the
 * useful range is compressed into the upper part of the scale with a gentle curve.
 */
export function dbToLevel(db: number): number {
  const n = Math.min(1, Math.max(0, (db + 58) / 46));
  return n ** 1.4;
}

export function pushLevel(callId: string, tx: boolean, db: number, now: number = performance.now()): void {
  const e = levels.get(callId) ?? { rx: 0, tx: 0, rxAt: 0, txAt: 0 };
  const level = dbToLevel(db);
  if (tx) {
    e.tx = level;
    e.txAt = now;
  } else {
    e.rx = level;
    e.rxAt = now;
  }
  levels.set(callId, e);
}

export function getLevel(callId: string, source: LevelSource, now: number = performance.now()): number {
  const e = levels.get(callId);
  if (!e) return 0;
  const at = source === "rx" ? e.rxAt : e.txAt;
  return now - at > STALE_MS ? 0 : source === "rx" ? e.rx : e.tx;
}

export function clearLevels(callId?: string): void {
  if (callId === undefined) levels.clear();
  else levels.delete(callId);
}
