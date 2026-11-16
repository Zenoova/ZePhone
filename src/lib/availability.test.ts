import { describe, expect, it } from "vitest";

import { makeAccount, makeStatus } from "@/test/fixtures";

import { availability } from "./availability";

describe("availability", () => {
  const on = makeAccount({ enabled: true });

  it("says whether an account can be reached", () => {
    expect(availability(on, makeStatus({ state: "registered" }))).toBe("Disponible");
    expect(availability(on, makeStatus({ state: "connecting" }))).toBe("Connexion…");
    expect(availability(on, makeStatus({ state: "disconnected" }))).toBe("Hors ligne");
    expect(availability(on, makeStatus({ state: "unconfigured" }))).toBe("Non configuré");
    expect(availability(on, undefined)).toBe("Hors ligne");
  });

  it("gives the SIP code of a failure", () => {
    expect(availability(on, makeStatus({ state: "error", sipCode: 403 }))).toBe("Indisponible · SIP 403");
    expect(availability(on, makeStatus({ state: "error", sipCode: null }))).toBe("Indisponible");
  });

  it("a disabled account is disabled, whatever its last state was", () => {
    expect(availability(makeAccount({ enabled: false }), makeStatus({ state: "registered" }))).toBe("Désactivé");
  });
});
