import { afterEach, describe, expect, it, vi } from "vitest";

import { appShortcut, isMac } from "./platform";

function userAgent(ua: string, touchPoints = 0) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
  // jsdom has no `maxTouchPoints`: it is defined here for the length of the test.
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
}

describe("how a shortcut of the application is written", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, "maxTouchPoints");
  });

  it("uses ⌘ on a Mac", () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(isMac()).toBe(true);
    expect(appShortcut("2")).toBe("⌘2");
  });

  it("uses Ctrl on Linux and Windows", () => {
    userAgent("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15");
    expect(isMac()).toBe(false);
    expect(appShortcut("2")).toBe("Ctrl+2");
    userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    expect(appShortcut("4")).toBe("Ctrl+4");
  });

  it("does not take an iPad that asks for the desktop version of pages for a Mac", () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5);
    expect(isMac()).toBe(false);
  });
});
