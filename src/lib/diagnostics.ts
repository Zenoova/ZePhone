import { telephony } from "@/services/telephony";

/** The usage counts the application may send (the backend refuses anything else). */
export type UsageEvent = "account_added" | "call_outgoing" | "call_incoming";

/**
 * Counts an event. Fire and forget: the backend does nothing unless the user allowed usage statistics, and a
 * failure here must never reach the user.
 */
export function track(event: UsageEvent, params?: Record<string, string>): void {
  try {
    void telephony.trackEvent(event, params).catch(() => undefined);
  } catch {
    /* diagnostics are optional */
  }
}

/** Browsers report this when a layout settles after a resize: not an error of ours. */
const NOISE = /ResizeObserver loop/i;

export function reportError(kind: string, message: string, stack?: string): void {
  if (NOISE.test(message)) return;
  try {
    void telephony.reportError(kind, message, stack).catch(() => undefined);
  } catch {
    /* diagnostics are optional */
  }
}

/** Forwards the errors nobody caught to the backend, which sends them only when the user allowed it. */
export function installErrorReporting(target: Window = window): void {
  target.addEventListener("error", (e) => {
    const err = e.error as unknown;
    if (err instanceof Error) reportError(err.name, err.message, err.stack);
    else reportError("Error", e.message);
  });
  target.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as unknown;
    if (reason instanceof Error) reportError(reason.name, reason.message, reason.stack);
    else reportError("UnhandledRejection", typeof reason === "string" ? reason : "Unhandled promise rejection");
  });
}
