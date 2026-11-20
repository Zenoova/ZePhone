/**
 * Whether the application runs on a phone or a tablet. The same page serves the computers and the phones; what differs is the
 * shape of the window (one window, one hand), not the features. `?platform=mobile` shows the phone layout in a
 * plain browser (`npm run dev`, `/?mock&platform=mobile`).
 */
/**
 * Whether the application runs on an iPhone or an iPad. Its navigation bar is then the system's own (see
 * `src-tauri/src/app/native_tabbar.rs`), not the page's dock.
 */
export function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator;
  return /iPhone|iPad/i.test(nav.userAgent) || (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator;
  return (
    /Android|iPhone|iPad/i.test(nav.userAgent) ||
    // An iPad asks for the desktop version of pages (its user agent says Macintosh), but a Mac has no touch screen.
    (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1) ||
    new URLSearchParams(window.location.search).get("platform") === "mobile"
  );
}
