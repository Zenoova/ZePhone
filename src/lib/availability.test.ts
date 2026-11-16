import { describe, expect, it } from "vitest";

import { makeAccount, makeStatus } from "@/test/fixtures";

import { availability } from "./availability";

describe("availability", () => {
  const on = makeAccount({ enabled: true });

  it("says whether an account can be reached", () => {
    expect(availability(on, makeStatus({ state: "registered" }))).toBe("Available");
    expect(availability(on, makeStatus({ state: "connecting" }))).toBe("Connecting…");
    expect(availability(on, makeStatus({ state: "disconnected" }))).toBe("Offline");
    expect(availability(on, makeStatus({ state: "unconfigured" }))).toBe("Not configured");
    expect(availability(on, undefined)).toBe("Offline");
  });

  it("gives the SIP code of a failure", () => {
    expect(availability(on, makeStatus({ state: "error", sipCode: 403 }))).toBe("Unavailable · SIP 403");
    expect(availability(on, makeStatus({ state: "error", sipCode: null }))).toBe("Unavailable");
  });

  it("a disabled account is disabled, whatever its last state was", () => {
    expect(availability(makeAccount({ enabled: false }), makeStatus({ state: "registered" }))).toBe("Disabled");
  });
});
