import type { OrbVariant } from "@/components/orbs/orbkit-core";

/** The original ZePhone bubble (2D canvas, no WebGL). */
export const CLASSIC_ORB = "classic";

export interface VoiceOrbEntry {
  /** Stored in the settings. Never rename one: it would reset the user's choice. */
  id: string;
  label: string;
  hint: string;
  /** Loads the OrbKit shader on demand (each one is its own chunk); absent for the classic bubble. */
  load?: () => Promise<OrbVariant>;
}

/**
 * The voice orbs the user can pick from: ZePhone's own bubble and the MIT-licensed shader orbs of OrbKit
 * (https://orbkit.zzzzshawn.cloud). OrbKit's 19 other orbs are ported from XorDev's shaders under a
 * non-commercial licence and are deliberately not bundled — see `src/components/orbs/README.md`.
 */
export const VOICE_ORBS: readonly VoiceOrbEntry[] = [
  { id: CLASSIC_ORB, label: "ZePhone", hint: "La bulle d'origine" },
  {
    id: "shdr-11",
    label: "Orbitale",
    hint: "Orbitale quantique aux bandes arc-en-ciel",
    load: () => import("@/components/orbs/shdr-11").then((m) => m.shdr11Orb),
  },
  {
    id: "shdr-13",
    label: "Plasma",
    hint: "Globe à plasma et ses éclairs",
    load: () => import("@/components/orbs/shdr-13").then((m) => m.shdr13Orb),
  },
  {
    id: "shdr-32",
    label: "Galaxie",
    hint: "Une galaxie de gaz et de poussière",
    load: () => import("@/components/orbs/shdr-32").then((m) => m.shdr32Orb),
  },
  {
    id: "shdr-21",
    label: "Nuage",
    hint: "Lumière diffusée par un nuage",
    load: () => import("@/components/orbs/shdr-21").then((m) => m.shdr21Orb),
  },
  {
    id: "shdr-16",
    label: "Caustiques",
    hint: "Soleil à travers l'eau",
    load: () => import("@/components/orbs/shdr-16").then((m) => m.shdr16Orb),
  },
  {
    id: "shdr-17",
    label: "Tempête",
    hint: "Une tempête granuleuse et colorée",
    load: () => import("@/components/orbs/shdr-17").then((m) => m.shdr17Orb),
  },
  {
    id: "shdr-27",
    label: "Radar",
    hint: "Mosaïque de radar météo",
    load: () => import("@/components/orbs/shdr-27").then((m) => m.shdr27Orb),
  },
  {
    id: "shdr-33",
    label: "Thermique",
    hint: "Image thermique imprimée",
    load: () => import("@/components/orbs/shdr-33").then((m) => m.shdr33Orb),
  },
  {
    id: "shdr-30",
    label: "Prairie",
    hint: "Un champ de fleurs qui se replie",
    load: () => import("@/components/orbs/shdr-30").then((m) => m.shdr30Orb),
  },
  {
    id: "shdr-24",
    label: "Terre voxel",
    hint: "Une planète en blocs",
    load: () => import("@/components/orbs/shdr-24").then((m) => m.shdr24Orb),
  },
  {
    id: "shdr-12",
    label: "Briques",
    hint: "Une boule de briques brillantes",
    load: () => import("@/components/orbs/shdr-12").then((m) => m.shdr12Orb),
  },
  {
    id: "shdr-29",
    label: "Mur de LED",
    hint: "Des dalles qui s'allument",
    load: () => import("@/components/orbs/shdr-29").then((m) => m.shdr29Orb),
  },
  {
    id: "shdr-14",
    label: "Pixels",
    hint: "Plasma en gros pixels",
    load: () => import("@/components/orbs/shdr-14").then((m) => m.shdr14Orb),
  },
  {
    id: "shdr-23",
    label: "ASCII",
    hint: "Matrice de caractères vert terminal",
    load: () => import("@/components/orbs/shdr-23").then((m) => m.shdr23Orb),
  },
];

/** What a new install shows. The original bubble stays one click away. */
export const DEFAULT_ORB = "shdr-32";

/** The entry for a stored id; an unknown id (renamed, removed, hand-edited) falls back to the default. */
export function findVoiceOrb(id: string | null | undefined): VoiceOrbEntry {
  return VOICE_ORBS.find((o) => o.id === id) ?? VOICE_ORBS.find((o) => o.id === DEFAULT_ORB)!;
}

const cache = new Map<string, Promise<OrbVariant>>();

/** Loads (once) the shader of an orb. Resolves `null` for the classic bubble. */
export function loadOrbVariant(id: string): Promise<OrbVariant | null> {
  const entry = findVoiceOrb(id);
  if (!entry.load) return Promise.resolve(null);
  let p = cache.get(entry.id);
  if (!p) {
    p = entry.load();
    cache.set(entry.id, p);
    // A failed chunk must be retried next time, not cached forever.
    p.catch(() => cache.delete(entry.id));
  }
  return p;
}
