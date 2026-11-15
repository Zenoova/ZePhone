import { afterEach, describe, expect, it } from "vitest";

import { isCallWindow } from "./window";

const w = window as unknown as { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  window.history.replaceState(null, "", "/");
});

describe("isCallWindow", () => {
  it("is the window labelled `call`", () => {
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "call" } } };
    expect(isCallWindow()).toBe(true);
  });

  it("is not the main window", () => {
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" } } };
    expect(isCallWindow()).toBe(false);
  });

  it("can be asked for in the browser preview", () => {
    window.history.replaceState(null, "", "/?mock&window=call");
    expect(isCallWindow()).toBe(true);
    window.history.replaceState(null, "", "/?mock");
    expect(isCallWindow()).toBe(false);
  });
});
