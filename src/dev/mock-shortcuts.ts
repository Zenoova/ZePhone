/**
 * DEV-ONLY stand-in for the shortcut commands of the Rust backend, used by the browser preview (`/?mock`) to see
 * the settings page. Nothing is registered with any system: the states below are scripted, and one shortcut is
 * deliberately shown as "not activated" to see that state.
 */
import type { ShortcutAction, ShortcutItem, ShortcutsView } from "@/types/shortcuts";

type Args = Record<string, unknown> | undefined;

const LABELS: Record<ShortcutAction, string> = {
  answer: "Answer",
  reject: "Decline the incoming call",
  hangup: "Hang up",
  toggleMute: "Mute / unmute the microphone",
  toggleHold: "Put on hold / resume",
  showDialer: "Show the keypad",
  showSearch: "Search for a contact",
  toggleDnd: "Do not disturb",
};
const KEYS: Record<ShortcutAction, string> = {
  answer: "A",
  reject: "D",
  hangup: "H",
  toggleMute: "M",
  toggleHold: "P",
  showDialer: "N",
  showSearch: "F",
  toggleDnd: "Z",
};

export function createMockShortcuts(): Record<string, (a: Args) => unknown> {
  let master = true;
  let capturing = false;
  const items = (Object.keys(LABELS) as ShortcutAction[]).map((action): ShortcutItem => ({
    action,
    label: LABELS[action],
    accelerator: `CommandOrControl+Alt+Shift+${KEYS[action]}`,
    display: `⌥⇧⌘${KEYS[action]}`,
    defaultAccelerator: `CommandOrControl+Alt+Shift+${KEYS[action]}`,
    isDefault: true,
    enabled: true,
    status: { kind: "active" },
  }));
  const view = (): ShortcutsView => ({
    enabled: master,
    capturing,
    mac: true,
    items: items.map((i) => ({
      ...i,
      status: !master
        ? i.accelerator
          ? { kind: "disabled" }
          : { kind: "unassigned" }
        : capturing
          ? { kind: "suspended" }
          : !i.accelerator
            ? { kind: "unassigned" }
            : !i.enabled
              ? { kind: "disabled" }
              : i.action === "toggleHold" && new URLSearchParams(window.location.search).get("mock") !== "showcase"
                ? { kind: "failed", message: "The system refused this combination (preview: fake state)" }
                : { kind: "active" },
    })),
  });
  const find = (a: Args) => items.find((i) => i.action === a?.action)!;
  return {
    shortcuts_get: () => view(),
    shortcuts_capture: (a) => {
      capturing = Boolean(a?.active);
      return view();
    },
    shortcuts_set_enabled: (a) => {
      master = Boolean(a?.enabled);
      return view();
    },
    shortcuts_set: (a) => {
      const it = find(a);
      const accelerator = (a?.accelerator as string | null) ?? null;
      const clash = items.find((o) => o !== it && accelerator && o.accelerator === accelerator);
      if (clash) throw { kind: "validation", message: `Already used for “${clash.label}”` };
      it.accelerator = accelerator;
      it.display = accelerator ? accelerator.replace("CommandOrControl", "⌘").replace(/\+/g, "") : null;
      it.enabled = Boolean(a?.enabled);
      it.isDefault = accelerator === it.defaultAccelerator && it.enabled;
      return view();
    },
    shortcuts_reset: (a) => {
      for (const it of items.filter((i) => !a?.action || i.action === a.action)) {
        it.accelerator = it.defaultAccelerator;
        it.display = `⌥⇧⌘${KEYS[it.action]}`;
        it.enabled = true;
        it.isDefault = true;
      }
      if (!a?.action) master = true;
      return view();
    },
  };
}
