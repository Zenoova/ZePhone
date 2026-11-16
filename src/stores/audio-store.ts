import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { AudioState, HeadsetState, Role } from "@/types/audio";

interface AudioStoreState {
  state: AudioState | null;
  headset: HeadsetState | null;
  /** The live microphone level while the test runs, in dBFS. */
  level: number | null;
  metering: boolean;
  load: () => Promise<void>;
  apply: (state: AudioState) => void;
  applyHeadset: (state: HeadsetState) => void;
  pushLevel: (db: number) => void;
  choose: (role: Role, uid: string, remember: boolean) => Promise<boolean>;
  test: (kind: "speaker" | "ringtone") => Promise<void>;
  meter: (on: boolean) => Promise<void>;
}

export const useAudioStore = create<AudioStoreState>((set) => ({
  state: null,
  headset: null,
  level: null,
  metering: false,

  load: async () => {
    try {
      const [state, headset] = await Promise.all([telephony.audioState(), telephony.headsetState()]);
      set({ state, headset });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  apply: (state) => set({ state }),
  applyHeadset: (headset) => set({ headset }),
  pushLevel: (level) => set({ level }),

  choose: async (role, uid, remember) => {
    try {
      await telephony.audioChoose(role, uid, remember);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  },

  test: async (kind) => {
    try {
      await telephony.audioTest(kind);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  meter: async (on) => {
    try {
      await telephony.audioMeter(on);
      set({ metering: on, level: on ? null : null });
    } catch (e) {
      set({ metering: false, level: null });
      toast.error(errorMessage(e));
    }
  },
}));
