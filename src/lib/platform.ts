/**
 * Whether the application runs on a phone. The same page serves the computers and the phones; what differs is the
 * shape of the window (one window, one hand), not the features. `?platform=mobile` shows the phone layout in a
 * plain browser (`npm run dev`, `/?mock&platform=mobile`).
 */
export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|iPhone|iPad/i.test(window.navigator.userAgent) ||
    new URLSearchParams(window.location.search).get("platform") === "mobile"
  );
}
