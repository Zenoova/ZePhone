import { describe, expect, it } from "vitest";

import { entrySubtitle, failureAction, intervalLabel, relativeTime, sortedPhones, sourceStatus } from "./directory";
import { makeSource } from "@/test/fixtures";

const now = new Date("2026-03-10T12:00:00Z");

describe("relativeTime", () => {
  it("speaks in the unit that fits", () => {
    expect(relativeTime(null, now)).toBe("jamais");
    expect(relativeTime("nonsense", now)).toBe("jamais");
    expect(relativeTime("2026-03-10T11:59:40Z", now)).toBe("à l'instant");
    expect(relativeTime("2026-03-10T11:55:00Z", now)).toBe("il y a 5 min");
    expect(relativeTime("2026-03-10T09:00:00Z", now)).toBe("il y a 3 h");
    expect(relativeTime("2026-03-08T12:00:00Z", now)).toBe("il y a 2 j");
    expect(relativeTime("2025-12-25T12:00:00Z", now)).toMatch(/^le \d/);
  });
});

describe("entrySubtitle and sortedPhones", () => {
  it("joins what is known about the role, skipping the blanks", () => {
    expect(entrySubtitle({ title: "Directrice", company: "Société", department: "Compta" })).toBe(
      "Directrice · Société · Compta",
    );
    expect(entrySubtitle({ title: null, company: " ", department: "Compta" })).toBe("Compta");
    expect(entrySubtitle({ title: null, company: null, department: null })).toBe("");
  });

  it("puts business numbers first, then extensions, then mobiles", () => {
    const kinds = sortedPhones([
      { kind: "other", number: "5" },
      { kind: "mobile", number: "3" },
      { kind: "work", number: "1" },
      { kind: "extension", number: "2" },
    ]).map((p) => p.number);
    expect(kinds).toEqual(["1", "2", "3", "5"]);
  });
});

describe("failureAction", () => {
  it("offers the action that fits the failure", () => {
    expect(failureAction({ errorKind: "auth", kind: "microsoftOrg" })).toEqual({
      action: "reconnect",
      label: "Reconnecter",
    });
    expect(failureAction({ errorKind: "auth", kind: "ldap" }).label).toBe("Saisir le mot de passe");
    expect(failureAction({ errorKind: "forbidden", kind: "microsoftOrg" }).action).toBe("reconnect");
    expect(failureAction({ errorKind: "config", kind: "ldap" }).action).toBe("configure");
    for (const k of ["network", "server", "throttled"] as const) {
      expect(failureAction({ errorKind: k, kind: "ldap" }).action).toBe("retry");
    }
    expect(failureAction({ errorKind: null, kind: "ldap" }).action).toBe("none");
  });
});

describe("sourceStatus", () => {
  it("says what state the source is in", () => {
    expect(sourceStatus(makeSource({ state: "disabled" }), now)).toBe("Déconnectée");
    expect(sourceStatus(makeSource({ state: "syncing" }), now)).toBe("Synchronisation en cours…");
    expect(sourceStatus(makeSource({ state: "needsReauth" }), now)).toBe("Reconnexion nécessaire");
    expect(sourceStatus(makeSource({ state: "idle", lastSuccessAt: "2026-03-10T11:00:00Z" }), now)).toBe(
      "Synchronisée il y a 1 h",
    );
    expect(sourceStatus(makeSource({ state: "error", lastSuccessAt: "2026-03-10T11:00:00Z" }), now)).toContain(
      "conservées",
    );
    expect(sourceStatus(makeSource({ kind: "local", state: "idle" }), now)).toBe("Toujours disponible");
  });

  it("names the intervals", () => {
    expect(intervalLabel(0)).toBe("Manuelle seulement");
    expect(intervalLabel(360)).toBe("Toutes les 6 heures");
    expect(intervalLabel(7)).toBe("Toutes les 7 minutes");
  });
});
