import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { ShortcutAction, ShortcutsView } from "@/types/shortcuts";

interface ShortcutsState {
  view: ShortcutsView | null;
  load: () => Promise<void>;
  /**
   * Sets one combination (`null` removes it). Returns the backend's reason when it is refused, so the page can
   * show it where the user is looking; nothing changed then.
   */
  set: (action: ShortcutAction, accelerator: string | null, enabled: boolean) => Promise<string | null>;
  setEnabled: (enabled: boolean) => Promise<void>;
  reset: (action?: ShortcutAction) => Promise<string | null>;
  /** Pauses the shortcuts while a combination is being recorded. */
  capture: (active: boolean) => Promise<void>;
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  view: null,

  load: async () => {
    try {
      set({ view: await telephony.shortcutsGet() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  set: async (action, accelerator, enabled) => {
    try {
      set({ view: await telephony.shortcutsSet(action, accelerator, enabled) });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },

  setEnabled: async (enabled) => {
    try {
      set({ view: await telephony.shortcutsSetEnabled(enabled) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  reset: async (action) => {
    try {
      set({ view: await telephony.shortcutsReset(action) });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },

  capture: async (active) => {
    try {
      set({ view: await telephony.shortcutsCapture(active) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
}));
