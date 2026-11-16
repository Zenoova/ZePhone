import { create } from "zustand";

export type Section = "dialer" | "contacts" | "history" | "recordings" | "settings";
export type SettingsTab = "accounts" | "directory" | "audio" | "network" | "notifications" | "general" | "about";

interface UiState {
  section: Section;
  settingsTab: SettingsTab;
  /** Number typed in the dialer (kept when navigating between sections). */
  dialValue: string;
  /** Set when the app runs outside Tauri (plain browser) so the UI can explain itself. */
  backendUnavailable: boolean;
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
  setSection: (section) => set({ section }),
  openSettings: (settingsTab) => set({ section: "settings", settingsTab }),
  setDialValue: (dialValue) => set({ dialValue }),
  prefillDial: (number) => set({ dialValue: number, section: "dialer" }),
  setBackendUnavailable: (backendUnavailable) => set({ backendUnavailable }),
}));
