import { describe, expect, it } from "vitest";

import { mainKey, recordKey, showModifiers } from "./accelerator";

const keys = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("recording a combination", () => {
  it("builds the portable text from the physical key, whatever the layout", () => {
    expect(recordKey(keys("KeyM", { metaKey: true, altKey: true, shiftKey: true }), true)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Alt+Shift+M",
    });
    // A French keyboard types "&" on the Digit1 key: the physical key is what counts.
    expect(recordKey(keys("Digit1", { metaKey: true }), true)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+1",
    });
  });

  it("tells ⌘ from Control on a Mac, and Ctrl from the Windows key elsewhere", () => {
    expect(recordKey(keys("KeyK", { ctrlKey: true, metaKey: true }), true)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Control+K",
    });
    expect(recordKey(keys("KeyK", { ctrlKey: true, metaKey: true }), false)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Super+K",
    });
  });

  it("waits while only modifiers are held", () => {
    expect(recordKey(keys("MetaLeft", { metaKey: true }), true)).toEqual({
      kind: "pending",
      modifiers: ["CommandOrControl"],
    });
    expect(recordKey(keys("ShiftRight", { shiftKey: true, altKey: true }), true)).toEqual({
      kind: "pending",
      modifiers: ["Alt", "Shift"],
    });
  });

  it("gives up on Escape, but Escape with a modifier is just an unsupported key", () => {
    expect(recordKey(keys("Escape"), true)).toEqual({ kind: "cancel" });
    expect(recordKey(keys("Escape", { metaKey: true }), true)).toEqual({ kind: "unsupported", key: "Escape" });
  });

  it("refuses keys that cannot be part of a combination", () => {
    expect(recordKey(keys("Comma", { metaKey: true }), true).kind).toBe("unsupported");
    expect(recordKey(keys("AudioVolumeUp"), true).kind).toBe("unsupported");
  });

  it("knows the named keys, the function keys and the arrows", () => {
    expect(mainKey("F13")).toBe("F13");
    expect(mainKey("F24")).toBe("F24");
    expect(mainKey("F25")).toBeNull();
    expect(mainKey("ArrowLeft")).toBe("Left");
    expect(mainKey("NumpadEnter")).toBe("Enter");
    expect(mainKey("Numpad7")).toBe("7");
  });

  it("shows the modifiers being held", () => {
    expect(showModifiers(["CommandOrControl", "Alt", "Shift"], true)).toBe("⌘⌥⇧");
    expect(showModifiers(["CommandOrControl", "Alt"], false)).toBe("Ctrl+Alt");
  });
});
