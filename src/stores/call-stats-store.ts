import { create } from "zustand";

import { telephony } from "@/services/telephony";
import type { CallStatsSample } from "@/types/telephony";

/** Samples kept per call: 15 minutes at one per second (as in the backend). */
export const MAX_SAMPLES = 900;

interface CallStatsState {
  /** The samples of each call in progress, oldest first. */
  samples: Record<string, CallStatsSample[]>;
  push: (sample: CallStatsSample) => void;
  /** Gets what happened before this window started listening (the backend keeps the history of the call). */
  load: (callId: string) => Promise<void>;
  drop: (callId: string) => void;
}

/** Joins two runs of samples of one call without doubles, oldest first. */
function merge(a: CallStatsSample[], b: CallStatsSample[]): CallStatsSample[] {
  const byTime = new Map<number, CallStatsSample>();
  for (const s of [...a, ...b]) byTime.set(s.atMs, s);
  return [...byTime.values()].sort((x, y) => x.atMs - y.atMs).slice(-MAX_SAMPLES);
}

export const useCallStatsStore = create<CallStatsState>((set, get) => ({
  samples: {},
  push: (sample) =>
    set((s) => {
      const list = s.samples[sample.callId] ?? [];
      const next = list.length >= MAX_SAMPLES ? [...list.slice(1), sample] : [...list, sample];
      return { samples: { ...s.samples, [sample.callId]: next } };
    }),
  load: async (callId) => {
    try {
      const history = await telephony.getCallStats(callId);
      set((s) => ({ samples: { ...s.samples, [callId]: merge(history, get().samples[callId] ?? []) } }));
    } catch {
      /* the live events fill the charts anyway */
    }
  },
  drop: (callId) =>
    set((s) => {
      if (!(callId in s.samples)) return s;
      const { [callId]: _gone, ...rest } = s.samples;
      return { samples: rest };
    }),
}));
