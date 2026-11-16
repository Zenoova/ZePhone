import type { DirectoryEntry, PhoneEntry, PhoneKind, SourceKind, SourceView, SyncErrorKind } from "@/types/directory";

export const PHONE_KIND_LABEL: Record<PhoneKind, string> = {
  work: "Professionnel",
  mobile: "Mobile",
  extension: "Poste interne",
  home: "Domicile",
  sip: "Adresse SIP",
  other: "Numéro",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  local: "Contacts locaux",
  ldap: "Annuaire LDAP",
  microsoftOrg: "Microsoft 365 · annuaire de l'organisation",
  microsoftPersonal: "Outlook · contacts personnels",
};

/** Short names for the badge that tells where a person comes from. */
export const SOURCE_BADGE: Record<SourceKind, string> = {
  local: "Local",
  ldap: "LDAP",
  microsoftOrg: "Microsoft 365",
  microsoftPersonal: "Outlook",
};

/** "Directrice · Société · Comptabilité": what is known about the person's role, without the name. */
export function entrySubtitle(e: Pick<DirectoryEntry, "title" | "company" | "department">): string {
  return [e.title, e.company, e.department].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
}

/** The numbers in the order a person would expect: business, internal extension, mobile, the rest. */
export function sortedPhones(phones: PhoneEntry[]): PhoneEntry[] {
  const rank: Record<PhoneKind, number> = { work: 0, extension: 1, mobile: 2, sip: 3, home: 4, other: 5 };
  return [...phones].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const MINUTE = 60_000;

/** "à l'instant", "il y a 5 min", "il y a 3 h", "il y a 2 j", or the date beyond a month. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "jamais";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "jamais";
  const diff = Math.max(0, now.getTime() - t);
  if (diff < MINUTE) return "à l'instant";
  if (diff < 60 * MINUTE) return `il y a ${Math.round(diff / MINUTE)} min`;
  if (diff < 24 * 60 * MINUTE) return `il y a ${Math.round(diff / (60 * MINUTE))} h`;
  if (diff < 30 * 24 * 60 * MINUTE) return `il y a ${Math.round(diff / (24 * 60 * MINUTE))} j`;
  return `le ${new Date(t).toLocaleDateString("fr-FR")}`;
}

export const INTERVAL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "0", label: "Manuelle seulement" },
  { value: "15", label: "Toutes les 15 minutes" },
  { value: "60", label: "Toutes les heures" },
  { value: "360", label: "Toutes les 6 heures" },
  { value: "1440", label: "Une fois par jour" },
];

export function intervalLabel(min: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === String(min))?.label ?? `Toutes les ${min} minutes`;
}

export type SourceAction = "retry" | "reconnect" | "configure" | "none";

/** What the user can do about a failed source: the action that fits the failure, and a sentence that says so. */
export function failureAction(source: Pick<SourceView, "errorKind" | "kind">): { action: SourceAction; label: string } {
  const k: SyncErrorKind | null = source.errorKind;
  switch (k) {
    case "auth":
      return { action: "reconnect", label: source.kind === "ldap" ? "Saisir le mot de passe" : "Reconnecter" };
    case "forbidden":
      return { action: "reconnect", label: "Reconnecter" };
    case "config":
      return { action: "configure", label: "Modifier la configuration" };
    case "invalid":
      return { action: "configure", label: "Vérifier la source" };
    case "network":
    case "server":
    case "throttled":
      return { action: "retry", label: "Réessayer" };
    default:
      return { action: "none", label: "" };
  }
}

/** The status line of a source, in words. */
export function sourceStatus(s: SourceView, now: Date = new Date()): string {
  switch (s.state) {
    case "disabled":
      return "Déconnectée";
    case "syncing":
      return "Synchronisation en cours…";
    case "needsReauth":
      return "Reconnexion nécessaire";
    case "error":
      return s.lastSuccessAt
        ? `Erreur · contacts conservés (dernière synchronisation ${relativeTime(s.lastSuccessAt, now)})`
        : "Erreur";
    default:
      return s.kind === "local" ? "Stockés sur cet ordinateur" : `Synchronisée ${relativeTime(s.lastSuccessAt, now)}`;
  }
}
