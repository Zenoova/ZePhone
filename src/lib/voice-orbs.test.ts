import { describe, expect, it } from "vitest";

import { CLASSIC_ORB, DEFAULT_ORB, VOICE_ORBS, findVoiceOrb, loadOrbVariant } from "./voice-orbs";

describe("voice orbs", () => {
  it("has unique ids the backend accepts", () => {
    const ids = VOICE_ORBS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
    expect(ids).toContain(CLASSIC_ORB);
  });

  it("falls back to the default orb for an unknown, empty or missing id", () => {
    for (const id of ["nope", "", null, undefined]) expect(findVoiceOrb(id).id).toBe(DEFAULT_ORB);
    expect(findVoiceOrb("shdr-11").label).toBe("Orbitale");
  });

  it("loads each shader on demand, under the id it is stored with", async () => {
    expect(await loadOrbVariant(CLASSIC_ORB)).toBeNull();
    for (const orb of VOICE_ORBS.filter((o) => o.load)) {
      const variant = await loadOrbVariant(orb.id);
      expect(variant?.key, orb.id).toBe(orb.id);
      expect(variant?.frag, orb.id).toEqual(expect.any(String));
    }
  });
});
