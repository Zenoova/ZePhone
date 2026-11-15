import type { Call } from "@/types/telephony";

/** `75` -> `01:15`, `3725` -> `1:02:05`. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "42 s", "3 min 05 s", "1 h 02 min": compact, for history rows. */
export function formatDurationHuman(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Aujourd'hui 14:32", "Hier 09:10", "12 nov. 14:32", "3 janv. 2025 08:00". */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = timeFmt.format(d);
  if (dayDiff === 0) return `Aujourd'hui ${time}`;
  if (dayDiff === 1) return `Hier ${time}`;
  const day = d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
  return `${day} ${time}`;
}

/** Seconds elapsed since an ISO timestamp (never negative). */
export function elapsedSince(iso: string | null, now: number = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 1000));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const letters = (first.charAt(0) + last.charAt(0)).toUpperCase();
  return /\p{L}|\p{N}/u.test(letters) ? letters : "#";
}

export function callDisplayName(call: Pick<Call, "remoteName" | "remoteNumber">): string {
  return call.remoteName?.trim() || call.remoteNumber || "Numéro inconnu";
}

/** "42 Ko", "3,4 Mo": a file size in French units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${Math.round(bytes)} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes;
  let i = -1;
  do {
    value /= 1000;
    i += 1;
  } while (value >= 1000 && i < units.length - 1);
  const tenth = Math.round(value * 10) / 10;
  const text = value >= 100 || Number.isInteger(tenth) ? String(Math.round(value)) : tenth.toFixed(1).replace(".", ",");
  return `${text} ${units[i]}`;
}
