import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { DEFAULT_ORB } from "@/lib/voice-orbs";
import { errorMessage, telephony } from "@/services/telephony";
import type { AudioDevices, MicPermission, Settings } from "@/types/telephony";

export const DEFAULT_SETTINGS: Settings = {
  audio: {
    inputDevice: null,
    outputDevice: null,
    inputGain: 100,
    outputGain: 100,
    routing: {
      microphone: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
      speaker: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
      ringer: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
      lostPolicy: "useFallback",
      allowPublicSpeaker: false,
    },
    headset: {
      mode: "auto",
      answer: true,
      hangUp: true,
      mute: true,
      hold: true,
      onlySelectedDevice: true,
      longPressMs: 800,
    },
  },
  notifications: { incomingCall: true, missedCall: true, ringtone: true },
  general: {
    theme: "system",
    launchAtLogin: false,
    startMinimized: false,
    closeToTray: true,
    showTrayIcon: true,
    translucent: true,
    voiceOrb: DEFAULT_ORB,
    doNotDisturb: false,
  },
  network: { customCaFile: null, sipTrace: false, localSipPort: null, netInterface: null },
  recording: { autoRecord: true },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  return {
    audio: { ...base.audio, ...patch.audio },
    notifications: { ...base.notifications, ...patch.notifications },
    general: { ...base.general, ...patch.general },
    network: { ...base.network, ...patch.network },
    recording: { ...base.recording, ...patch.recording },
  } as Settings;
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  restartRequired: boolean;
  devices: AudioDevices | null;
  micPermission: MicPermission | null;
  load: () => Promise<void>;
  /** The settings changed elsewhere (another window saved them): adopt them without saving again. */
  adopt: (settings: Settings) => void;
  update: (patch: DeepPartial<Settings>) => Promise<boolean>;
  loadDevices: () => Promise<void>;
  refreshMic: () => Promise<void>;
  requestMic: () => Promise<void>;
  clearRestartRequired: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  restartRequired: false,
  devices: null,
  micPermission: null,

  load: async () => {
    try {
      set({ settings: await telephony.getSettings(), loaded: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  adopt: (settings) => set({ settings }),

  update: async (patch) => {
    const previous = get().settings;
    const next = mergeSettings(previous, patch);
    set({ settings: next }); // optimistic
    try {
      const applied = await telephony.updateSettings(next);
      set({ settings: applied.settings, restartRequired: get().restartRequired || applied.restartRequired });
      return true;
    } catch (e) {
      set({ settings: previous });
      toast.error(errorMessage(e));
      return false;
    }
  },

  loadDevices: async () => {
    try {
      set({ devices: await telephony.listAudioDevices() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  refreshMic: async () => {
    try {
      set({ micPermission: await telephony.getMicrophonePermission() });
    } catch {
      /* ignore */
    }
  },

  requestMic: async () => {
    try {
      set({ micPermission: await telephony.requestMicrophonePermission() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  clearRestartRequired: () => set({ restartRequired: false }),
}));
