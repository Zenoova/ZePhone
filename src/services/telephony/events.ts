import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AccountStatus, AudioLevelEvent, Call, EngineInfo, Settings } from "@/types/telephony";

/** Event names emitted by the Rust backend (see `src-tauri/src/app/mod.rs`). */
export const EVENTS = {
  engineState: "engine:state",
  accountStatus: "account:status",
  callUpdate: "call:update",
  historyChanged: "history:changed",
  audioError: "audio:error",
  audioLevel: "audio:level",
  recordingsChanged: "recordings:changed",
  settingsChanged: "settings:changed",
} as const;

export interface TelephonyHandlers {
  onEngineState?: (info: EngineInfo) => void;
  onAccountStatus?: (status: AccountStatus) => void;
  onCallUpdate?: (call: Call) => void;
  onHistoryChanged?: () => void;
  onAudioError?: (message: string) => void;
  onAudioLevel?: (level: AudioLevelEvent) => void;
  onRecordingsChanged?: () => void;
  /** The settings were saved, here or in another window. */
  onSettingsChanged?: (settings: Settings) => void;
}

/** Subscribes to every backend event; returns a function that removes all listeners. */
export async function subscribeTelephony(h: TelephonyHandlers): Promise<() => void> {
  const unlisteners: UnlistenFn[] = await Promise.all([
    listen<EngineInfo>(EVENTS.engineState, (e) => h.onEngineState?.(e.payload)),
    listen<AccountStatus>(EVENTS.accountStatus, (e) => h.onAccountStatus?.(e.payload)),
    listen<Call>(EVENTS.callUpdate, (e) => h.onCallUpdate?.(e.payload)),
    listen<null>(EVENTS.historyChanged, () => h.onHistoryChanged?.()),
    listen<string>(EVENTS.audioError, (e) => h.onAudioError?.(e.payload)),
    listen<AudioLevelEvent>(EVENTS.audioLevel, (e) => h.onAudioLevel?.(e.payload)),
    listen<null>(EVENTS.recordingsChanged, () => h.onRecordingsChanged?.()),
    listen<Settings>(EVENTS.settingsChanged, (e) => h.onSettingsChanged?.(e.payload)),
  ]);
  return () => unlisteners.forEach((u) => u());
}
