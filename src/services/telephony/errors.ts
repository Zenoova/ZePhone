import type { AppError } from "@/types/telephony";

/** Normalises whatever `invoke` rejects with into an {@link AppError}. */
export function toAppError(e: unknown): AppError {
  if (typeof e === "string") return { kind: "unknown", message: e };
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") {
      const kind = typeof o.kind === "string" ? (o.kind as AppError["kind"]) : "unknown";
      return { kind, message: o.message };
    }
  }
  return { kind: "unknown", message: "Erreur inattendue" };
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}
