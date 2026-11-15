import { describe, expect, it } from "vitest";

import { DEFAULT_ORB, VOICE_ORBS, findVoiceOrb, loadOrbVariant } from "./voice-orbs";

describe("voice orbs", () => {
  it("has unique ids the backend accepts", () => {
    const ids = VOICE_ORBS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
    expect(ids).toContain(DEFAULT_ORB);
  });

  it("names every orb in English, one distinct plain name each", () => {
    const labels = VOICE_ORBS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[A-Za-z][A-Za-z ]*$/);
    expect(findVoiceOrb("shdr-32").label).toBe("Galaxy");
  });

  it("falls back to the default orb for an unknown, retired, empty or missing id", () => {
    for (const id of ["nope", "classic", "", null, undefined]) expect(findVoiceOrb(id).id).toBe(DEFAULT_ORB);
  });

  it("loads each shader on demand, under the id it is stored with", async () => {
    for (const orb of VOICE_ORBS) {
      const variant = await loadOrbVariant(orb.id);
      expect(variant.key, orb.id).toBe(orb.id);
      expect(variant.frag, orb.id).toEqual(expect.any(String));
    }
  });
});
