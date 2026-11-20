import { beforeEach, describe, expect, it, vi } from "vitest";

const { telephony } = vi.hoisted(() => ({
  telephony: {
    trackEvent: vi.fn(() => Promise.resolve()),
    reportError: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@/services/telephony", () => ({ telephony }));

import { installErrorReporting, reportError, track } from "./diagnostics";

beforeEach(() => vi.clearAllMocks());

describe("diagnostics", () => {
  it("passes an event to the backend", () => {
    track("account_added", { transport: "tls" });
    expect(telephony.trackEvent).toHaveBeenCalledWith("account_added", { transport: "tls" });
  });

  it("never throws, even when the backend is missing or refuses", async () => {
    telephony.trackEvent.mockImplementationOnce(() => {
      throw new Error("no backend");
    });
    expect(() => track("call_outgoing")).not.toThrow();
    telephony.reportError.mockImplementationOnce(() => Promise.reject(new Error("refused")));
    expect(() => reportError("Error", "boom")).not.toThrow();
    await Promise.resolve();
  });

  it("ignores the resize observer noise", () => {
    reportError("Error", "ResizeObserver loop completed with undelivered notifications.");
    expect(telephony.reportError).not.toHaveBeenCalled();
  });

  it("forwards uncaught errors and rejected promises", () => {
    const target = new EventTarget() as unknown as Window;
    installErrorReporting(target);
    const boom = new TypeError("x is undefined");
    target.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: boom.message }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
    expect(telephony.reportError).toHaveBeenNthCalledWith(1, "TypeError", "x is undefined", boom.stack);
    expect(telephony.reportError).toHaveBeenNthCalledWith(2, "UnhandledRejection", "nope", undefined);
  });
});
