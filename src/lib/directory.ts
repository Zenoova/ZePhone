import { thisDevice } from "@/lib/platform";
import type { DirectoryEntry, PhoneEntry, PhoneKind, SourceKind, SourceView, SyncErrorKind } from "@/types/directory";

export const PHONE_KIND_LABEL: Record<PhoneKind, string> = {
  work: "Work",
  mobile: "Mobile",
  extension: "Internal extension",
  home: "Domicile",
  sip: "SIP address",
  other: "Number",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  local: "Local contacts",
  ldap: "LDAP directory",
  microsoftOrg: "Microsoft 365 · organization directory",
  microsoftPersonal: "Outlook · personal contacts",
  systemContacts: "Device contacts",
};

/** Short names for the badge that tells where a person comes from. */
export const SOURCE_BADGE: Record<SourceKind, string> = {
  local: "Local",
  ldap: "LDAP",
  microsoftOrg: "Microsoft 365",
  microsoftPersonal: "Outlook",
  systemContacts: "Device",
};

/** "Director · Company · Accounting": what is known about the person's role, without the name. */
export function entrySubtitle(e: Pick<DirectoryEntry, "title" | "company" | "department">): string {
  return [e.title, e.company, e.department].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
}

/** The numbers in the order a person would expect: business, internal extension, mobile, the rest. */
export function sortedPhones(phones: PhoneEntry[]): PhoneEntry[] {
  const rank: Record<PhoneKind, number> = { work: 0, extension: 1, mobile: 2, sip: 3, home: 4, other: 5 };
  return [...phones].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const MINUTE = 60_000;

/** "just now", "5 min ago", "3 h ago", "2 d ago", or the date beyond a month. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const diff = Math.max(0, now.getTime() - t);
  if (diff < MINUTE) return "just now";
  if (diff < 60 * MINUTE) return `${Math.round(diff / MINUTE)} min ago`;
  if (diff < 24 * 60 * MINUTE) return `${Math.round(diff / (60 * MINUTE))} h ago`;
  if (diff < 30 * 24 * 60 * MINUTE) return `${Math.round(diff / (24 * 60 * MINUTE))} d ago`;
  return `on ${new Date(t).toLocaleDateString("en-US")}`;
}

export const INTERVAL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "0", label: "Manual only" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440", label: "Once a day" },
];

export function intervalLabel(min: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === String(min))?.label ?? `Every ${min} minutes`;
}

export type SourceAction = "retry" | "reconnect" | "configure" | "none";

/** What the user can do about a failed source: the action that fits the failure, and a sentence that says so. */
export function failureAction(source: Pick<SourceView, "errorKind" | "kind">): { action: SourceAction; label: string } {
  const k: SyncErrorKind | null = source.errorKind;
  // The device's address book has no password: what it lacks is the user's permission.
  if (source.kind === "systemContacts" && k === "forbidden") return { action: "reconnect", label: "Allow access" };
  switch (k) {
    case "auth":
      return { action: "reconnect", label: source.kind === "ldap" ? "Enter the password" : "Reconnect" };
    case "forbidden":
      return { action: "reconnect", label: "Reconnect" };
    case "config":
      return { action: "configure", label: "Edit the configuration" };
    case "invalid":
      return { action: "configure", label: "Check the source" };
    case "network":
    case "server":
    case "throttled":
      return { action: "retry", label: "Try again" };
    default:
      return { action: "none", label: "" };
  }
}

/** The status line of a source, in words. */
export function sourceStatus(s: SourceView, now: Date = new Date()): string {
  switch (s.state) {
    case "disabled":
      return "Disconnected";
    case "syncing":
      return "Syncing…";
    case "needsReauth":
      return "Reconnection needed";
    case "error":
      return s.lastSuccessAt ? `Error · contacts kept (last sync ${relativeTime(s.lastSuccessAt, now)})` : "Error";
    default:
      return s.kind === "local" ? `Stored on ${thisDevice()}` : `Synced ${relativeTime(s.lastSuccessAt, now)}`;
  }
}
