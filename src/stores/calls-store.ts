import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { clearLevels } from "@/lib/audio-levels";
import { playMuteSound } from "@/lib/ui-sounds";
import { errorMessage, telephony } from "@/services/telephony";
import type { Call } from "@/types/telephony";

/** How long a finished call stays visible ("Terminé" / "Échec") before disappearing. */
export const ENDED_LINGER_MS = 4000;

interface CallsState {
  calls: Record<string, Call>;
  dialing: boolean;
  hydrate: (calls: Call[]) => void;
  apply: (call: Call) => void;
  dismiss: (id: string) => void;
  dial: (target: string, accountId?: string | null) => Promise<Call | null>;
  answer: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  hangup: (id: string) => Promise<void>;
  toggleHold: (id: string) => Promise<void>;
  toggleMute: (id: string) => Promise<void>;
  sendDtmf: (id: string, digits: string) => Promise<void>;
  transfer: (id: string, target: string) => Promise<boolean>;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function run(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

export const useCallsStore = create<CallsState>((set, get) => ({
  calls: {},
  dialing: false,

  hydrate: (calls) => set({ calls: Object.fromEntries(calls.map((c) => [c.id, c])) }),

  apply: (call) => {
    set((s) => ({ calls: { ...s.calls, [call.id]: call } }));
    const terminal = call.state === "ended" || call.state === "failed";
    const pending = timers.get(call.id);
    if (pending) clearTimeout(pending);
    if (terminal) {
      clearLevels(call.id);
      timers.set(
        call.id,
        setTimeout(() => get().dismiss(call.id), ENDED_LINGER_MS),
      );
      if (call.state === "failed") toast.error(call.reason ?? "L'appel a échoué");
    } else {
      timers.delete(call.id);
    }
  },

  dismiss: (id) => {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set((s) => {
      const { [id]: _gone, ...rest } = s.calls;
      return { calls: rest };
    });
  },

  dial: async (target, accountId) => {
    set({ dialing: true });
    try {
      const call = await telephony.dial(target, accountId);
      get().apply(call);
      return call;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      set({ dialing: false });
    }
  },

  answer: async (id) => void (await run(() => telephony.answerCall(id))),
  reject: async (id) => void (await run(() => telephony.rejectCall(id))),
  hangup: async (id) => void (await run(() => telephony.hangupCall(id))),

  toggleHold: async (id) => {
    const call = get().calls[id];
    if (!call) return;
    await run(() => (call.heldLocally ? telephony.resumeCall(id) : telephony.holdCall(id)));
  },

  toggleMute: async (id) => {
    const call = get().calls[id];
    if (!call) return;
    const muted = !call.muted;
    if (await run(() => telephony.setCallMute(id, muted))) playMuteSound(muted);
  },

  sendDtmf: async (id, digits) => void (await run(() => telephony.sendDtmf(id, digits))),
  transfer: (id, target) => run(() => telephony.transferCall(id, target)),
}));

export const isTerminal = (c: Call): boolean => c.state === "ended" || c.state === "failed";

/** Live calls first (incoming before others), then the ones lingering after they ended. */
export function sortedCalls(calls: Record<string, Call>): Call[] {
  const rank = (c: Call) => (c.state === "incoming" ? 0 : isTerminal(c) ? 2 : 1);
  return Object.values(calls).sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

export const selectIncoming = (calls: Record<string, Call>): Call[] =>
  Object.values(calls).filter((c) => c.state === "incoming");

export const selectLiveCalls = (calls: Record<string, Call>): Call[] =>
  sortedCalls(calls).filter((c) => c.state !== "incoming" && !isTerminal(c));
