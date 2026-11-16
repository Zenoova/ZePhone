/** Types shared with the Rust backend (`src-tauri/src/audio/*`, `src-tauri/src/headset/*`). */

export type Transport = "builtIn" | "usb" | "bluetooth" | "display" | "virtual" | "other";

export interface DeviceInfo {
  /** The system's unique identifier: stable across reconnections. */
  uid: string;
  name: string;
  transport: Transport;
  inputChannels: number;
  outputChannels: number;
  alive: boolean;
  /** A loudspeaker the room hears (laptop speakers, a screen). */
  publicSpeaker: boolean;
  /** Some application uses this device now (which one is not known). */
  inUseElsewhere: boolean;
  /** The engine can select it by name. */
  selectable: boolean;
  /** Another device has the same name. */
  duplicateName: boolean;
}

export interface AudioSnapshot {
  devices: DeviceInfo[];
  defaultInput: string | null;
  defaultOutput: string | null;
  alertOutput: string | null;
}

export type Role = "microphone" | "speaker" | "ringer";
export type Follow = "systemDefault" | "systemAlerts" | "communication";

export interface DeviceRef {
  uid: string | null;
  name: string;
}

export type Selection = { kind: "follow"; source: Follow } | { kind: "explicit"; device: DeviceRef };

export interface RoleChoice {
  selection: Selection;
  fallback: DeviceRef | null;
}

export type LostPolicy = "ask" | "useFallback" | "useSystemDefault";

export interface Routing {
  microphone: RoleChoice;
  speaker: RoleChoice;
  ringer: RoleChoice;
  lostPolicy: LostPolicy;
  allowPublicSpeaker: boolean;
}

export type Source = "following" | "chosen" | "fallback" | "systemInstead" | "nothing";

export type Problem =
  | { kind: "chosenUnavailable"; name: string }
  | { kind: "fallbackUnavailable"; name: string }
  | { kind: "ambiguousName"; name: string }
  | { kind: "nameNotSelectable"; name: string }
  | { kind: "duplicateName"; name: string }
  | { kind: "communicationUnsupported" }
  | { kind: "noDevice" };

export interface Resolution {
  role: Role;
  used: DeviceInfo | null;
  source: Source;
  problems: Problem[];
  learnedUid: string | null;
}

export type AskWhy = "deviceLost" | "publicSpeaker" | "nothingLeft";
export type Why = "systemChanged" | "fallback" | "systemDefault";

export type Notice = { role: Role } & (
  | { kind: "lost"; name: string; why: AskWhy; blocked: string | null }
  | { kind: "switched"; from: string; to: string; why: Why }
  | { kind: "failed"; name: string; message: string }
);

export interface RoleState {
  role: Role;
  label: string;
  choice: RoleChoice;
  /** What the system gives for this choice now. */
  resolution: Resolution;
  /** What the engine confirmed it uses. */
  inUse: DeviceInfo | null;
  notice: Notice | null;
  refused: string | null;
  choices: DeviceInfo[];
}

export interface AudioState {
  snapshot: AudioSnapshot;
  roles: RoleState[];
  routing: Routing;
  inCall: boolean;
  supportsCommunicationDefault: boolean;
}

// ---------------------------------------------------------------- headset

export type HeadsetMode = "auto" | "system" | "vendor" | "off";

export interface HeadsetSettings {
  mode: HeadsetMode;
  answer: boolean;
  hangUp: boolean;
  mute: boolean;
  hold: boolean;
  onlySelectedDevice: boolean;
  longPressMs: number;
}

export type HeadsetButton =
  "hookSwitch" | "flash" | "hold" | "drop" | "phoneMute" | { other: { page: number; usage: number } };

export interface HidDevice {
  id: string;
  product: string;
  manufacturer: string;
  transport: string;
  buttons: HeadsetButton[];
  /** This is the headset whose audio ZePhone uses. */
  inUse: boolean;
}

export type Reading =
  { kind: "idle" } | { kind: "listening" } | { kind: "permissionNeeded" } | { kind: "unavailable"; message: string };

export interface HeadsetLogEntry {
  at: string;
  device: string;
  button: string;
  value: number;
  result: string;
  acted: boolean;
}

export interface HeadsetState {
  settings: HeadsetSettings;
  reading: Reading;
  devices: HidDevice[];
  log: HeadsetLogEntry[];
  vendorAvailable: boolean;
}
