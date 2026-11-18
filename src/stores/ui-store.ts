import { create } from "zustand";

export type Section = "dialer" | "contacts" | "history" | "recordings" | "settings";
export type SettingsTab =
  "accounts" | "directory" | "audio" | "network" | "notifications" | "shortcuts" | "general" | "about";

/** Where the window was brought forward by a shortcut or the command line: the page that should take the keyboard. */
export type FocusTarget = "dialer" | "search";

interface UiState {
  section: Section;
  settingsTab: SettingsTab;
  /** Number typed in the dialer (kept when navigating between sections). */
  dialValue: string;
  /** Set when the app runs outside Tauri (plain browser) so the UI can explain itself. */
  backendUnavailable: boolean;
  /** A page asked to take the keyboard (the window was brought forward on it). The page clears it once it has. */
  focusRequest: FocusTarget | null;
  /** Phones only: the call screen is put away so the rest of the application can be used during the call. */
  callHidden: boolean;
  setCallHidden: (hidden: boolean) => void;
  requestFocus: (target: FocusTarget) => void;
  clearFocusRequest: () => void;
  setSection: (section: Section) => void;
  openSettings: (tab: SettingsTab) => void;
  setDialValue: (v: string) => void;
  /** Jump to the dialer with a number prefilled (from contacts / history). */
  prefillDial: (number: string) => void;
  setBackendUnavailable: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  section: "dialer",
  settingsTab: "accounts",
  dialValue: "",
  backendUnavailable: false,
  focusRequest: null,
  callHidden: false,
  setCallHidden: (callHidden) => set({ callHidden }),
  requestFocus: (target) => set({ focusRequest: target, section: target === "search" ? "contacts" : "dialer" }),
  clearFocusRequest: () => set({ focusRequest: null }),
  setSection: (section) => set({ section }),
  openSettings: (settingsTab) => set({ section: "settings", settingsTab }),
  setDialValue: (dialValue) => set({ dialValue }),
  prefillDial: (number) => set({ dialValue: number, section: "dialer" }),
  setBackendUnavailable: (backendUnavailable) => set({ backendUnavailable }),
}));
