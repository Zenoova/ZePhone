import { describe, expect, it } from "vitest";

import { makeHistory } from "@/test/fixtures";

import { countUnseenMissed } from "./history-store";

describe("countUnseenMissed", () => {
  const entries = [
    makeHistory({ id: "1", result: "missed", endedAt: "2026-01-02T10:00:00Z" }),
    makeHistory({ id: "2", result: "missed", endedAt: "2026-01-01T10:00:00Z" }),
    makeHistory({ id: "3", result: "answered", endedAt: "2026-01-03T10:00:00Z" }),
  ];
  it("counts only missed calls newer than the last visit", () => {
    expect(countUnseenMissed(entries, "2026-01-01T12:00:00Z")).toBe(1);
    expect(countUnseenMissed(entries, "")).toBe(2);
    expect(countUnseenMissed(entries, "2026-02-01T00:00:00Z")).toBe(0);
  });
});
