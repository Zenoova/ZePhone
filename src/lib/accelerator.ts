/**
 * Reading a combination from the keyboard while the user records one.
 *
 * Only a first pass: it turns what was pressed into the portable text the backend reads
 * (`CommandOrControl+Alt+Shift+A`). The backend does the real checking (no bare key, nothing the system keeps,
 * no duplicate) and its message is the one shown.
 */

export type Recorded =
  /** Modifiers held, no main key yet. */
  | { kind: "pending"; modifiers: string[] }
  /** A main key was pressed with them. */
  | { kind: "done"; accelerator: string }
  /** Escape: give up. */
  | { kind: "cancel" }
  /** The key cannot be part of a combination. */
  | { kind: "unsupported"; key: string };

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** The main key from the physical key (`code`): independent of the layout, as the system's own registration is. */
export function mainKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/** `mac`: ⌘ is the portable "CommandOrControl" and the Control key is a modifier of its own. Elsewhere, the reverse. */
export function heldModifiers(
  e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  mac: boolean,
): string[] {
  const out: string[] = [];
  if (mac) {
    if (e.metaKey) out.push("CommandOrControl");
    if (e.ctrlKey) out.push("Control");
  } else {
    if (e.ctrlKey) out.push("CommandOrControl");
    if (e.metaKey) out.push("Super");
  }
  if (e.altKey) out.push("Alt");
  if (e.shiftKey) out.push("Shift");
  return out;
}

export function recordKey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  mac: boolean,
): Recorded {
  const modifiers = heldModifiers(e, mac);
  if (e.code === "Escape" && modifiers.length === 0) return { kind: "cancel" };
  if (MODIFIER_CODES.has(e.code)) return { kind: "pending", modifiers };
  const key = mainKey(e.code);
  if (!key) return { kind: "unsupported", key: e.code };
  return { kind: "done", accelerator: [...modifiers, key].join("+") };
}

/** The symbols of the modifiers being held, for the live hint while recording. */
export function showModifiers(modifiers: string[], mac: boolean): string {
  const symbol = (m: string): string => {
    if (mac) return { CommandOrControl: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧" }[m] ?? m;
    return { CommandOrControl: "Ctrl", Super: "Win", Alt: "Alt", Shift: "Maj" }[m] ?? m;
  };
  return modifiers.map(symbol).join(mac ? "" : "+");
}
