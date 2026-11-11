import { describe, expect, it } from "vitest";

import { makeCall } from "@/test/fixtures";
import type { Call } from "@/types/telephony";

import { shouldReturnToDialer } from "./call-flow";

const by = (...calls: Call[]) => Object.fromEntries(calls.map((c) => [c.id, c]));

describe("shouldReturnToDialer", () => {
  it("returns to the dialer when the only call just ended", () => {
    const live = makeCall({ state: "connected" });
    expect(shouldReturnToDialer(by(live), by({ ...live, state: "ended" }), "calls")).toBe(true);
  });

  it("also for a failed or never-answered call", () => {
    expect(shouldReturnToDialer({}, by(makeCall({ state: "failed" })), "calls")).toBe(true);
    const ringing = makeCall({ state: "incoming", direction: "incoming" });
    expect(shouldReturnToDialer(by(ringing), by({ ...ringing, state: "ended" }), "calls")).toBe(true);
  });

  it("stays while another call is still live", () => {
    const a = makeCall({ id: "a", state: "connected" });
    const b = makeCall({ id: "b", state: "connected" });
    expect(shouldReturnToDialer(by(a, b), by({ ...a, state: "ended" }, b), "calls")).toBe(false);
  });

  it("does not move someone who is on another screen", () => {
    const live = makeCall({ state: "connected" });
    for (const section of ["settings", "contacts", "history", "dialer"]) {
      expect(shouldReturnToDialer(by(live), by({ ...live, state: "ended" }), section)).toBe(false);
    }
  });

  it("ignores updates that are not an ending", () => {
    const live = makeCall({ state: "dialing" });
    expect(shouldReturnToDialer(by(live), by({ ...live, state: "ringing" }), "calls")).toBe(false);
    // The lingering "ended" call being re-delivered must not re-trigger.
    const ended = makeCall({ state: "ended" });
    expect(shouldReturnToDialer(by(ended), by(ended), "calls")).toBe(false);
  });

  it("does nothing when there is no call", () => {
    expect(shouldReturnToDialer({}, {}, "calls")).toBe(false);
  });
});
