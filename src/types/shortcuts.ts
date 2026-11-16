/** Types shared with the Rust backend (`src-tauri/src/shortcuts/mod.rs`). */

export type ShortcutAction =
  "answer" | "reject" | "hangup" | "toggleMute" | "toggleHold" | "showDialer" | "showSearch" | "toggleDnd";

/**
 * Where a combination stands. `failed` means it is saved but the system could not register it: it does nothing,
 * and `message` says why.
 */
export type BindingStatus =
  | { kind: "active" }
  | { kind: "disabled" }
  | { kind: "unassigned" }
  | { kind: "suspended" }
  | { kind: "failed"; message: string };

export interface ShortcutItem {
  action: ShortcutAction;
  label: string;
  /** Canonical text such as `CommandOrControl+Alt+Shift+A`. */
  accelerator: string | null;
  /** How to show it (`⌥⇧⌘A`). */
  display: string | null;
  defaultAccelerator: string;
  isDefault: boolean;
  enabled: boolean;
  status: BindingStatus;
}

export interface ShortcutsView {
  /** The master switch. */
  enabled: boolean;
  capturing: boolean;
  mac: boolean;
  items: ShortcutItem[];
}
