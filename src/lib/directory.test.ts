import { describe, expect, it } from "vitest";

import { entrySubtitle, failureAction, intervalLabel, relativeTime, sortedPhones, sourceStatus } from "./directory";
import { makeSource } from "@/test/fixtures";

const now = new Date("2026-03-10T12:00:00Z");

describe("relativeTime", () => {
  it("speaks in the unit that fits", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("nonsense", now)).toBe("never");
    expect(relativeTime("2026-03-10T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-03-10T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-03-10T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-03-08T12:00:00Z", now)).toBe("2 d ago");
    expect(relativeTime("2025-12-25T12:00:00Z", now)).toMatch(/^on \d/);
  });
});

describe("entrySubtitle and sortedPhones", () => {
  it("joins what is known about the role, skipping the blanks", () => {
    expect(entrySubtitle({ title: "Director", company: "Company", department: "Accounting" })).toBe(
      "Director · Company · Accounting",
    );
    expect(entrySubtitle({ title: null, company: " ", department: "Accounting" })).toBe("Accounting");
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
      label: "Reconnect",
    });
    expect(failureAction({ errorKind: "auth", kind: "ldap" }).label).toBe("Enter the password");
    expect(failureAction({ errorKind: "forbidden", kind: "microsoftOrg" }).action).toBe("reconnect");
    expect(failureAction({ errorKind: "config", kind: "ldap" }).action).toBe("configure");
    for (const k of ["network", "server", "throttled"] as const) {
      expect(failureAction({ errorKind: k, kind: "ldap" }).action).toBe("retry");
    }
    expect(failureAction({ errorKind: null, kind: "ldap" }).action).toBe("none");
    // the device's address book has no password: what it lacks is the user's permission
    expect(failureAction({ errorKind: "forbidden", kind: "systemContacts" })).toEqual({
      action: "reconnect",
      label: "Allow access",
    });
  });
});

describe("sourceStatus", () => {
  it("says what state the source is in", () => {
    expect(sourceStatus(makeSource({ state: "disabled" }), now)).toBe("Disconnected");
    expect(sourceStatus(makeSource({ state: "syncing" }), now)).toBe("Syncing…");
    expect(sourceStatus(makeSource({ state: "needsReauth" }), now)).toBe("Reconnection needed");
    expect(sourceStatus(makeSource({ state: "idle", lastSuccessAt: "2026-03-10T11:00:00Z" }), now)).toBe(
      "Synced 1 h ago",
    );
    expect(sourceStatus(makeSource({ state: "error", lastSuccessAt: "2026-03-10T11:00:00Z" }), now)).toContain(
      "contacts kept (last sync 1 h ago)",
    );
    expect(sourceStatus(makeSource({ kind: "local", state: "idle" }), now)).toBe("Stored on this computer");
  });

  it("names the intervals", () => {
    expect(intervalLabel(0)).toBe("Manual only");
    expect(intervalLabel(360)).toBe("Every 6 hours");
    expect(intervalLabel(7)).toBe("Every 7 minutes");
  });
});
