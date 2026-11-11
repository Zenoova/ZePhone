import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { HistoryEntry, HistoryKind } from "@/types/telephony";

const SEEN_KEY = "zephone.history.seenAt";

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

interface HistoryState {
  entries: HistoryEntry[];
  query: string;
  kind: HistoryKind;
  loaded: boolean;
  /** ISO timestamp of the last time the user looked at the history (for the missed-call badge). */
  seenAt: string;
  load: () => Promise<void>;
  setQuery: (q: string) => void;
  setKind: (k: HistoryKind) => void;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  markSeen: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  query: "",
  kind: "all",
  loaded: false,
  seenAt: readSeen(),
  load: async () => {
    const { query, kind } = get();
    try {
      const entries = await telephony.listHistory({ query: query || null, kind, limit: 300 });
      if (query === get().query && kind === get().kind) set({ entries, loaded: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
  setQuery: (query) => set({ query }),
  setKind: (kind) => set({ kind }),
  remove: async (id) => {
    try {
      await telephony.deleteHistoryEntry(id);
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
  clear: async () => {
    try {
      await telephony.clearHistory();
      set({ entries: [] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
  markSeen: () => {
    const seenAt = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, seenAt);
    } catch {
      /* private mode: badge simply resets on restart */
    }
    set({ seenAt });
  },
}));

/** Missed calls newer than the last visit to the history page. */
export function countUnseenMissed(entries: HistoryEntry[], seenAt: string): number {
  return entries.filter((e) => e.result === "missed" && e.endedAt > seenAt).length;
}
