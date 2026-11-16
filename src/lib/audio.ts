import type {
  AskWhy,
  DeviceInfo,
  Notice,
  Problem,
  Role,
  RoleChoice,
  Selection,
  Source,
  Transport,
} from "@/types/audio";

export const ROLE_LABEL: Record<Role, string> = {
  microphone: "Microphone",
  speaker: "Conversation output",
  ringer: "Ringtone",
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  builtIn: "Built-in",
  usb: "USB",
  bluetooth: "Bluetooth",
  display: "Screen",
  virtual: "Virtual",
  other: "Other",
};

/** What the role is doing about its choice, in words. */
export const SOURCE_LABEL: Record<Source, string> = {
  following: "Follows the system",
  chosen: "Explicit choice",
  fallback: "Backup device",
  systemInstead: "System default (the choice is absent)",
  nothing: "No device",
};

export function problemText(p: Problem): string {
  switch (p.kind) {
    case "chosenUnavailable":
      return `“${p.name}” is not plugged in: it will be used again as soon as it returns.`;
    case "fallbackUnavailable":
      return `The backup device “${p.name}” is not plugged in either.`;
    case "ambiguousName":
      return `Several devices are called “${p.name}” and this choice, saved before ZePhone kept identifiers, does not say which: choose it again.`;
    case "duplicateName":
      return `Two devices are called “${p.name}”: the audio engine chooses by name and cannot guarantee which one it opens.`;
    case "nameNotSelectable":
      return `The audio engine cannot use a device named “${p.name}” (comma, # or name too long).`;
    case "communicationUnsupported":
      return "This system has no “communication” device: the default device is followed.";
    case "noDevice":
      return "No device available for this function.";
  }
}

const ASK_WHY: Record<AskWhy, string> = {
  deviceLost: "The call continues, but the sound no longer goes through it. Choose another device.",
  publicSpeaker:
    "The call was not moved to speakers that everyone can hear: you did not allow it. Choose the device to use.",
  nothingLeft: "No device is available. The call stays open: plug one in or choose one.",
};

export function noticeTitle(n: Notice): string {
  switch (n.kind) {
    case "lost":
      return `“${n.name}” is no longer available`;
    case "switched":
      return `The sound moved from “${n.from}” to “${n.to}”`;
    case "failed":
      return `“${n.name}” could not be used`;
  }
}

export function noticeDetail(n: Notice): string {
  switch (n.kind) {
    case "lost":
      return `${ASK_WHY[n.why]}${n.blocked ? ` (“${n.blocked}” would have been used.)` : ""}`;
    case "switched":
      return n.why === "fallback"
        ? "The backup device you configured took over."
        : n.why === "systemDefault"
          ? "The system's default device took over, as you allowed."
          : "The system changed its default device and this setting follows it.";
    case "failed":
      return `${n.message}. The previous device is still in use.`;
  }
}

/** A Bluetooth headset that is both a speaker and a microphone switches to its telephone profile when used. */
export function bluetoothNote(d: DeviceInfo | null | undefined): string | null {
  if (!d || d.transport !== "bluetooth" || d.inputChannels === 0 || d.outputChannels === 0) return null;
  return "With a Bluetooth headset, using its microphone switches it to phone mode: the sound becomes less faithful. This is a Bluetooth constraint, not a ZePhone setting.";
}

// --- the value of a device select, and back

export const FOLLOW_DEFAULT = "follow:systemDefault";
export const FOLLOW_ALERTS = "follow:systemAlerts";
export const NO_FALLBACK = "none";

export function selectionValue(s: Selection): string {
  if (s.kind === "follow") return s.source === "systemAlerts" ? FOLLOW_ALERTS : FOLLOW_DEFAULT;
  return `dev:${s.device.uid ?? `name:${s.device.name}`}`;
}

export function choiceWith(choice: RoleChoice, value: string, devices: DeviceInfo[]): RoleChoice {
  if (value === FOLLOW_DEFAULT) return { ...choice, selection: { kind: "follow", source: "systemDefault" } };
  if (value === FOLLOW_ALERTS) return { ...choice, selection: { kind: "follow", source: "systemAlerts" } };
  const uid = value.replace(/^dev:/, "");
  const d = devices.find((x) => x.uid === uid);
  if (!d) return choice;
  return { ...choice, selection: { kind: "explicit", device: { uid: d.uid, name: d.name } } };
}

export function fallbackWith(choice: RoleChoice, value: string, devices: DeviceInfo[]): RoleChoice {
  if (value === NO_FALLBACK) return { ...choice, fallback: null };
  const d = devices.find((x) => x.uid === value);
  return d ? { ...choice, fallback: { uid: d.uid, name: d.name } } : choice;
}
