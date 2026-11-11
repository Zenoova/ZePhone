import { invoke } from "@tauri-apps/api/core";

import type {
  AccountInput,
  AccountView,
  AppInfo,
  AudioDevices,
  Call,
  Contact,
  ContactInput,
  HistoryEntry,
  HistoryFilter,
  MicPermission,
  Settings,
  SettingsApplied,
  Snapshot,
} from "@/types/telephony";

import { toAppError } from "./errors";

/** True when running inside the Tauri webview (false in a plain browser, e.g. `vite dev`). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toAppError(e);
  }
}

/**
 * Strongly-typed surface of the Rust backend. The frontend never sees SIP: it
 * sends intents (dial, answer, hold...) and receives state.
 */
export const telephony = {
  // state
  getSnapshot: () => call<Snapshot>("get_snapshot"),
  restartEngine: () => call<void>("restart_engine"),
  getEngineLog: (lines?: number) => call<string[]>("get_engine_log", { lines }),
  getAppInfo: () => call<AppInfo>("get_app_info"),
  quit: () => call<void>("quit_app"),

  // accounts
  listAccounts: () => call<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => call<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => call<void>("delete_account", { id }),
  setDefaultAccount: (id: string) => call<void>("set_default_account", { id }),
  setAccountEnabled: (id: string, enabled: boolean) => call<void>("set_account_enabled", { id, enabled }),
  connectAccount: (id: string) => call<void>("connect_account", { id }),
  disconnectAccount: (id: string) => call<void>("disconnect_account", { id }),

  // calls
  dial: (target: string, accountId?: string | null) => call<Call>("dial", { target, accountId: accountId ?? null }),
  answerCall: (id: string) => call<void>("answer_call", { id }),
  rejectCall: (id: string) => call<void>("reject_call", { id }),
  hangupCall: (id: string) => call<void>("hangup_call", { id }),
  holdCall: (id: string) => call<void>("hold_call", { id }),
  resumeCall: (id: string) => call<void>("resume_call", { id }),
  setCallMute: (id: string, muted: boolean) => call<void>("set_call_mute", { id, muted }),
  sendDtmf: (id: string, digits: string) => call<void>("send_dtmf", { id, digits }),
  transferCall: (id: string, target: string) => call<void>("transfer_call", { id, target }),

  // contacts
  listContacts: (query?: string) => call<Contact[]>("list_contacts", { query: query ?? null }),
  saveContact: (input: ContactInput) => call<Contact>("save_contact", { input }),
  deleteContact: (id: string) => call<void>("delete_contact", { id }),

  // history
  listHistory: (filter?: HistoryFilter) => call<HistoryEntry[]>("list_history", { filter: filter ?? null }),
  deleteHistoryEntry: (id: string) => call<void>("delete_history_entry", { id }),
  clearHistory: () => call<void>("clear_history"),

  // settings & audio
  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (settings: Settings) => call<SettingsApplied>("update_settings", { settings }),
  listAudioDevices: () => call<AudioDevices>("list_audio_devices"),
  getMicrophonePermission: () => call<MicPermission>("get_microphone_permission"),
  requestMicrophonePermission: () => call<MicPermission>("request_microphone_permission"),
  openMicrophoneSettings: () => call<void>("open_microphone_settings"),
};

export type Telephony = typeof telephony;
