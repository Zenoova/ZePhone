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
  speaker: "Sortie des conversations",
  ringer: "Sonnerie",
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  builtIn: "Intégré",
  usb: "USB",
  bluetooth: "Bluetooth",
  display: "Écran",
  virtual: "Virtuel",
  other: "Autre",
};

/** What the role is doing about its choice, in words. */
export const SOURCE_LABEL: Record<Source, string> = {
  following: "Suit le système",
  chosen: "Choix explicite",
  fallback: "Périphérique de secours",
  systemInstead: "Défaut du système (le choix est absent)",
  nothing: "Aucun périphérique",
};

export function problemText(p: Problem): string {
  switch (p.kind) {
    case "chosenUnavailable":
      return `« ${p.name} » n'est pas branché : il sera utilisé de nouveau dès son retour.`;
    case "fallbackUnavailable":
      return `Le périphérique de secours « ${p.name} » n'est pas branché non plus.`;
    case "ambiguousName":
      return `Plusieurs périphériques s'appellent « ${p.name} » et ce choix, enregistré avant que ZePhone retienne les identifiants, ne permet pas de savoir lequel : choisissez-le de nouveau.`;
    case "duplicateName":
      return `Deux périphériques s'appellent « ${p.name} » : le moteur audio choisit par le nom et ne peut pas garantir lequel il ouvre.`;
    case "nameNotSelectable":
      return `Le moteur audio ne sait pas utiliser un périphérique dont le nom est « ${p.name} » (virgule, # ou nom trop long).`;
    case "communicationUnsupported":
      return "Ce système n'a pas de périphérique « communication » : le périphérique par défaut est suivi.";
    case "noDevice":
      return "Aucun périphérique disponible pour cette fonction.";
  }
}

const ASK_WHY: Record<AskWhy, string> = {
  deviceLost: "L'appel continue, mais le son n'y passe plus. Choisissez un autre périphérique.",
  publicSpeaker:
    "L'appel n'a pas été basculé sur des haut-parleurs que tout le monde entend : vous ne l'avez pas autorisé. Choisissez le périphérique à utiliser.",
  nothingLeft: "Aucun périphérique n'est disponible. L'appel reste ouvert : branchez-en un ou choisissez-en un.",
};

export function noticeTitle(n: Notice): string {
  switch (n.kind) {
    case "lost":
      return `« ${n.name} » n'est plus disponible`;
    case "switched":
      return `Le son est passé de « ${n.from} » à « ${n.to} »`;
    case "failed":
      return `« ${n.name} » n'a pas pu être utilisé`;
  }
}

export function noticeDetail(n: Notice): string {
  switch (n.kind) {
    case "lost":
      return `${ASK_WHY[n.why]}${n.blocked ? ` (« ${n.blocked} » aurait été utilisé.)` : ""}`;
    case "switched":
      return n.why === "fallback"
        ? "Le périphérique de secours que vous avez configuré a pris le relais."
        : n.why === "systemDefault"
          ? "Le périphérique par défaut du système a pris le relais, comme vous l'avez autorisé."
          : "Le système a changé de périphérique par défaut et ce réglage le suit.";
    case "failed":
      return `${n.message}. Le périphérique précédent reste utilisé.`;
  }
}

/** A Bluetooth headset that is both a speaker and a microphone switches to its telephone profile when used. */
export function bluetoothNote(d: DeviceInfo | null | undefined): string | null {
  if (!d || d.transport !== "bluetooth" || d.inputChannels === 0 || d.outputChannels === 0) return null;
  return "Avec un casque Bluetooth, utiliser son micro le fait passer en mode téléphone : le son devient moins fidèle. C'est une contrainte du Bluetooth, pas un réglage de ZePhone.";
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
