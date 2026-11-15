import type { OrbVariant } from "@/components/orbs/orbkit-core";

export interface VoiceOrbEntry {
  /** Stored in the settings. Never rename one: it would reset the user's choice. */
  id: string;
  /** Shown under the orb in the picker. Always in English, whatever the language of the app. */
  label: string;
  /** Loads the shader on demand: each orb is its own chunk. */
  load: () => Promise<OrbVariant>;
}

/**
 * The voice orbs the user can pick from: the MIT-licensed shader orbs of OrbKit (https://orbkit.zzzzshawn.cloud).
 * OrbKit's 19 other orbs are ported from XorDev's shaders under a non-commercial licence and are deliberately
 * not bundled — see `src/components/orbs/README.md`.
 */
export const VOICE_ORBS: readonly VoiceOrbEntry[] = [
  { id: "shdr-11", label: "Orbital", load: () => import("@/components/orbs/shdr-11").then((m) => m.shdr11Orb) },
  { id: "shdr-13", label: "Plasma", load: () => import("@/components/orbs/shdr-13").then((m) => m.shdr13Orb) },
  { id: "shdr-32", label: "Galaxy", load: () => import("@/components/orbs/shdr-32").then((m) => m.shdr32Orb) },
  { id: "shdr-21", label: "Cloud", load: () => import("@/components/orbs/shdr-21").then((m) => m.shdr21Orb) },
  { id: "shdr-16", label: "Caustics", load: () => import("@/components/orbs/shdr-16").then((m) => m.shdr16Orb) },
  { id: "shdr-17", label: "Storm", load: () => import("@/components/orbs/shdr-17").then((m) => m.shdr17Orb) },
  { id: "shdr-27", label: "Radar", load: () => import("@/components/orbs/shdr-27").then((m) => m.shdr27Orb) },
  { id: "shdr-33", label: "Thermal", load: () => import("@/components/orbs/shdr-33").then((m) => m.shdr33Orb) },
  { id: "shdr-30", label: "Meadow", load: () => import("@/components/orbs/shdr-30").then((m) => m.shdr30Orb) },
  { id: "shdr-24", label: "Voxel Earth", load: () => import("@/components/orbs/shdr-24").then((m) => m.shdr24Orb) },
  { id: "shdr-12", label: "Bricks", load: () => import("@/components/orbs/shdr-12").then((m) => m.shdr12Orb) },
  { id: "shdr-29", label: "LED Wall", load: () => import("@/components/orbs/shdr-29").then((m) => m.shdr29Orb) },
  { id: "shdr-14", label: "Pixels", load: () => import("@/components/orbs/shdr-14").then((m) => m.shdr14Orb) },
  { id: "shdr-23", label: "ASCII", load: () => import("@/components/orbs/shdr-23").then((m) => m.shdr23Orb) },
];

/** What a new install shows. */
export const DEFAULT_ORB = "shdr-32";

/** The entry for a stored id; an unknown id (renamed, removed, hand-edited) falls back to the default. */
export function findVoiceOrb(id: string | null | undefined): VoiceOrbEntry {
  return VOICE_ORBS.find((o) => o.id === id) ?? VOICE_ORBS.find((o) => o.id === DEFAULT_ORB)!;
}

const cache = new Map<string, Promise<OrbVariant>>();

/** Loads (once) the shader of an orb. */
export function loadOrbVariant(id: string): Promise<OrbVariant> {
  const entry = findVoiceOrb(id);
  let p = cache.get(entry.id);
  if (!p) {
    p = entry.load();
    cache.set(entry.id, p);
    // A failed chunk must be retried next time, not cached forever.
    p.catch(() => cache.delete(entry.id));
  }
  return p;
}
