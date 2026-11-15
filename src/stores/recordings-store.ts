import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { Recording } from "@/types/telephony";

interface RecordingsState {
  recordings: Recording[];
  loaded: boolean;
  load: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => ({
  recordings: [],
  loaded: false,
  load: async () => {
    try {
      set({ recordings: await telephony.listRecordings(), loaded: true });
    } catch (e) {
      // Recording may simply be unavailable (no folder): an empty list is the right answer then.
      set({ loaded: true });
      console.warn("recordings:", errorMessage(e));
    }
  },
  remove: async (id) => {
    const previous = get().recordings;
    set({ recordings: previous.filter((r) => r.id !== id) });
    try {
      await telephony.deleteRecording(id);
    } catch (e) {
      set({ recordings: previous });
      toast.error(errorMessage(e));
    }
  },
}));
