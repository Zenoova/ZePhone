import { invoke } from "@tauri-apps/api/core";

import type {
  AccountInput,
  AccountView,
  AppInfo,
  AudioDevices,
  Call,
  CallStatsSample,
  Contact,
  ContactInput,
  HistoryEntry,
  HistoryFilter,
  MicPermission,
  Recording,
  Settings,
  SettingsApplied,
  Snapshot,
} from "@/types/telephony";

import type {
  DepartmentCount,
  DirectoryPage,
  DirectoryQuery,
  GroupView,
  LdapSourceInput,
  LdapTestResult,
  MicrosoftSourceInput,
  SourceView,
  SystemContactsInfo,
} from "@/types/directory";

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

  // recording and volumes
  listRecordings: () => call<Recording[]>("list_recordings"),
  deleteRecording: (id: string) => call<void>("delete_recording", { id }),
  /** Live volume change (percent), not saved: the settings are what makes it last. */
  setAudioGains: (input: number, output: number) => call<void>("set_audio_gains", { input, output }),
  /** The statistics gathered so far about a call in progress (one sample per second, oldest first). */
  getCallStats: (callId: string) => call<CallStatsSample[]>("get_call_stats", { callId }),
  /** Brings the call window up (it is opened by the backend when a call starts). */
  openCallWindow: () => call<void>("open_call_window"),
  closeCallWindow: () => call<void>("close_call_window"),
  setCallWindowOnTop: (onTop: boolean) => call<void>("set_call_window_on_top", { onTop }),
  /** Brings the main window up (from the call window). */
  showMain: () => call<void>("show_main"),

  // contacts
  listContacts: (query?: string) => call<Contact[]>("list_contacts", { query: query ?? null }),
  saveContact: (input: ContactInput) => call<Contact>("save_contact", { input }),
  deleteContact: (id: string) => call<void>("delete_contact", { id }),

  // company directory
  directorySearch: (query: DirectoryQuery) => call<DirectoryPage>("directory_search", { query }),
  directoryDepartments: () => call<DepartmentCount[]>("directory_departments"),
  directorySources: () => call<SourceView[]>("directory_sources"),
  /** What to dial for a number as the directory shows it (spaces, brackets and extension marker removed). */
  directoryDialable: (number: string) => call<string | null>("directory_dialable", { number }),
  /** Whether the device's own address book can be connected here, and whether it was already allowed. */
  directorySystemContactsInfo: () => call<SystemContactsInfo>("directory_system_contacts_info"),
  /** Connects the device's address book; the system asks the user's permission the first time. */
  directoryConnectSystemContacts: () => call<SourceView>("directory_connect_system_contacts"),
  directoryOpenContactsPrivacySettings: () => call<void>("directory_open_contacts_privacy_settings"),
  directoryTestLdap: (input: LdapSourceInput) => call<LdapTestResult>("directory_test_ldap", { input }),
  directorySaveLdap: (input: LdapSourceInput) => call<SourceView>("directory_save_ldap", { input }),
  /** Signs in with Microsoft in the browser; returns when the sign-in is over. */
  directoryConnectMicrosoft: (input: MicrosoftSourceInput) =>
    call<SourceView>("directory_connect_microsoft", { input }),
  directoryCancelConnect: () => call<void>("directory_cancel_connect"),
  directorySync: (id: string) => call<void>("directory_sync", { id }),
  directorySetSource: (id: string, name: string, enabled: boolean, syncIntervalMin: number) =>
    call<SourceView>("directory_set_source", { id, name, enabled, syncIntervalMin }),
  directoryDisconnect: (id: string) => call<void>("directory_disconnect", { id }),
  directoryRemoveSource: (id: string) => call<void>("directory_remove_source", { id }),
  directoryClearCache: (id: string) => call<void>("directory_clear_cache", { id }),
  directorySetFavorite: (ids: string[], favorite: boolean) => call<void>("directory_set_favorite", { ids, favorite }),
  directoryGroups: () => call<GroupView[]>("directory_groups"),
  directoryCreateGroup: (name: string) => call<GroupView>("directory_create_group", { name }),
  directoryRenameGroup: (id: string, name: string) => call<void>("directory_rename_group", { id, name }),
  directoryDeleteGroup: (id: string) => call<void>("directory_delete_group", { id }),
  directoryGroupAdd: (groupId: string, ids: string[]) => call<void>("directory_group_add", { groupId, ids }),
  directoryGroupRemove: (groupId: string, ids: string[]) => call<void>("directory_group_remove", { groupId, ids }),

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
