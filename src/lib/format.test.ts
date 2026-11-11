import { describe, expect, it } from "vitest";

import { callDisplayName, elapsedSince, formatDateTime, formatDuration, formatDurationHuman, initials } from "./format";

describe("formatDuration", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(75)).toBe("01:15");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
  it("clamps negatives and truncates fractions", () => {
    expect(formatDuration(-5)).toBe("00:00");
    expect(formatDuration(59.9)).toBe("00:59");
  });
});

describe("formatDurationHuman", () => {
  it("is compact", () => {
    expect(formatDurationHuman(42)).toBe("42 s");
    expect(formatDurationHuman(185)).toBe("3 min 05 s");
    expect(formatDurationHuman(3720)).toBe("1 h 02 min");
  });
});

describe("formatDateTime", () => {
  const now = new Date(2026, 10, 11, 15, 0, 0); // 11 Nov 2026 15:00 local
  it("uses relative days", () => {
    expect(formatDateTime(new Date(2026, 10, 11, 9, 5).toISOString(), now)).toMatch(/^Aujourd'hui 09:05$/);
    expect(formatDateTime(new Date(2026, 10, 10, 23, 59).toISOString(), now)).toMatch(/^Hier 23:59$/);
  });
  it("uses a short date otherwise, with the year only when different", () => {
    expect(formatDateTime(new Date(2026, 8, 3, 8, 0).toISOString(), now)).toMatch(/^3 sept\.? 08:00$/);
    expect(formatDateTime(new Date(2024, 0, 3, 8, 0).toISOString(), now)).toMatch(/2024 08:00$/);
  });
  it("tolerates garbage", () => {
    expect(formatDateTime("not a date", now)).toBe("");
  });
});

describe("elapsedSince", () => {
  it("counts seconds and never goes negative", () => {
    const t = new Date("2026-01-01T10:00:00Z").getTime();
    expect(elapsedSince("2026-01-01T10:00:00Z", t + 65_400)).toBe(65);
    expect(elapsedSince("2026-01-01T10:00:00Z", t - 5000)).toBe(0);
    expect(elapsedSince(null)).toBe(0);
    expect(elapsedSince("garbage")).toBe(0);
  });
});

describe("initials / display name", () => {
  it("builds initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  bob  ")).toBe("B");
    expect(initials("Jean Pierre Dupont")).toBe("JD");
    expect(initials("")).toBe("?");
    expect(initials("+33612")).toBe("#");
  });
  it("prefers the name over the number", () => {
    expect(callDisplayName({ remoteName: "Bob", remoteNumber: "1002" })).toBe("Bob");
    expect(callDisplayName({ remoteName: null, remoteNumber: "1002" })).toBe("1002");
    expect(callDisplayName({ remoteName: " ", remoteNumber: "" })).toBe("Numéro inconnu");
  });
});
