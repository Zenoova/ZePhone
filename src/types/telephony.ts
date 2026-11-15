/**
 * Types shared with the Rust backend (serde, camelCase). Keep in sync with
 * `src-tauri/src/sip/types.rs`, `sip/manager.rs` and `audio/`.
 */

// --------------------------------------------------------------- accounts

export type Transport = "udp" | "tcp" | "tls";
export type MediaEncryption = "none" | "srtp" | "srtp-mandatory";

export interface Account {
  id: string;
  label: string;
  displayName: string | null;
  server: string;
  port: number;
  domain: string;
  username: string;
  authUsername: string | null;
  transport: Transport;
  outboundProxy: string | null;
  /** Seconds; 0 disables registration (direct calls only). */
  registerInterval: number;
  mediaEncryption: MediaEncryption;
  enabled: boolean;
  isDefault: boolean;
}

export interface AccountView extends Account {
  hasPassword: boolean;
}

export interface AccountInput {
  id?: string | null;
  label: string;
  displayName?: string | null;
  server: string;
  port?: number | null;
  domain?: string | null;
  username: string;
  authUsername?: string | null;
  transport: Transport;
  outboundProxy?: string | null;
  registerInterval?: number | null;
  mediaEncryption: MediaEncryption;
  enabled: boolean;
  /** Only sent when the user types one; omitted/empty keeps the stored secret. */
  password?: string | null;
}

export type RegistrationState = "unconfigured" | "connecting" | "registered" | "disconnected" | "error";

export interface AccountStatus {
  accountId: string;
  state: RegistrationState;
  sipCode: number | null;
  reason: string | null;
  message: string | null;
  updatedAt: string;
}

// ------------------------------------------------------------------ calls

export type CallDirection = "incoming" | "outgoing";

export type CallState =
  "initializing" | "dialing" | "ringing" | "incoming" | "connected" | "onHold" | "ended" | "failed";

export interface Call {
  id: string;
  accountId: string | null;
  accountLabel: string | null;
  direction: CallDirection;
  state: CallState;
  remoteUri: string;
  remoteNumber: string;
  remoteName: string | null;
  muted: boolean;
  /** The call is being recorded locally. */
  recording: boolean;
  /** We put the call on hold. */
  heldLocally: boolean;
  /** The remote party put the call on hold. */
  heldRemotely: boolean;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSecs: number;
  sipCode: number | null;
  reason: string | null;
}

export type CallResult = "answered" | "missed" | "rejected" | "failed" | "cancelled";

export interface HistoryEntry {
  id: string;
  accountId: string | null;
  accountLabel: string | null;
  remoteUri: string;
  remoteNumber: string;
  contactName: string | null;
  direction: CallDirection;
  result: CallResult;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  durationSecs: number;
  sipCode: number | null;
  reason: string | null;
}

export type HistoryKind = "all" | "incoming" | "outgoing" | "missed" | "failed";

export interface HistoryFilter {
  query?: string | null;
  kind?: HistoryKind;
  limit?: number;
  offset?: number;
}

// --------------------------------------------------------------- contacts

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  number: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  id?: string | null;
  firstName: string;
  lastName: string;
  company?: string | null;
  number: string;
}

// -------------------------------------------------------------- recording

export interface Recording {
  id: string;
  historyId: string | null;
  fileName: string;
  /** Absolute path of the audio file (play it with `convertFileSrc`). */
  path: string;
  startedAt: string;
  durationSecs: number;
  sizeBytes: number;
  remoteNumber: string;
  remoteName: string | null;
  accountLabel: string | null;
  direction: CallDirection;
  /** Waveform: loudness across the call, 0-255. */
  peaks: number[];
}

// --------------------------------------------------------------- settings

export type Theme = "system" | "light" | "dark";

export interface Settings {
  audio: {
    inputDevice: string | null;
    outputDevice: string | null;
    /** What the other party hears, in percent of the microphone level (0-200). */
    inputGain: number;
    /** What we hear, in percent (0-200). */
    outputGain: number;
  };
  notifications: { incomingCall: boolean; missedCall: boolean; ringtone: boolean };
  general: {
    theme: Theme;
    launchAtLogin: boolean;
    startMinimized: boolean;
    closeToTray: boolean;
    showTrayIcon: boolean;
    /** Frosted-glass window background (macOS only). */
    translucent: boolean;
    /** Id of the voice orb of the call screen (`VOICE_ORBS`). */
    voiceOrb: string;
  };
  network: {
    customCaFile: string | null;
    sipTrace: boolean;
    localSipPort: number | null;
    netInterface: string | null;
  };
  recording: {
    /** Record every call as soon as it is answered. */
    autoRecord: boolean;
  };
}

export interface SettingsApplied {
  settings: Settings;
  restartRequired: boolean;
}

// ----------------------------------------------------------------- engine

export type EngineStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running" }
  | { state: "restarting"; attempt: number; reason: string }
  | { state: "failed"; reason: string };

export type EngineInfo = {
  name: string;
  version: string | null;
  codecs: string[];
} & EngineStatus;

export interface Snapshot {
  engine: EngineInfo;
  accounts: AccountView[];
  statuses: AccountStatus[];
  calls: Call[];
}

// ------------------------------------------------------------------ audio

export interface AudioDevice {
  name: string;
  isDefault: boolean;
  selectable: boolean;
}

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

/** Live level of a call's audio (`audio:level` event): `tx` is our microphone, otherwise the remote voice. */
export interface AudioLevelEvent {
  callId: string;
  tx: boolean;
  /** dBFS, -96 (silence) … 0. */
  db: number;
}

export type MicPermission = "notDetermined" | "denied" | "restricted" | "authorized";

// ----------------------------------------------------------------- system

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  dataDir: string;
  engine: EngineInfo;
}

export interface AppError {
  kind: "validation" | "notFound" | "database" | "secret" | "engine" | "other" | "unknown";
  message: string;
}
