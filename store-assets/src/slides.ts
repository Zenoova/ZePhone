/**
 * Every store picture that is one composition (the iPhone pair has its own file). One entry = one PNG:
 * `out/<set>/<id>.png`. The screen is a capture of the real app (scripts/capture.mjs), in the theme of the slide.
 *
 * What the pictures say is what the app really does (README, "Features"): a directory that joins local contacts,
 * LDAP and Microsoft 365; statistics that explain a bad call in plain words; global shortcuts; separate microphone,
 * speaker and ringtone; the voice orb driven by the real audio level; local recordings.
 */
export type Theme = "light" | "dark";
export type Kind = "iphone" | "android" | "ipad" | "tablet" | "mac" | "desktop";

export interface Slide {
  id: string;
  set: string;
  kind: Kind;
  theme: Theme;
  title: string;
  sub?: string;
  /** Capture name without the theme suffix, e.g. "phone-stats" → public/phone-stats-light.png */
  screen: string;
  /** A desktop scene (main window + call window) instead of a single capture. */
  scene?: { main: string; call: string };
  /** The Icon Composer icon above the title (App Store). */
  icon?: boolean;
}

/** Sizes the stores ask for (docs/STORE-LISTING.md). */
export const SIZES: Record<Kind, { width: number; height: number }> = {
  iphone: { width: 1320, height: 2868 }, // App Store, 6.9"
  ipad: { width: 2752, height: 2064 }, // App Store, 13" landscape
  mac: { width: 2880, height: 1800 }, // Mac App Store
  android: { width: 1080, height: 1920 }, // Google Play phone, Samsung, Huawei, Aptoide
  tablet: { width: 2560, height: 1600 }, // Google Play 10" tablet
  desktop: { width: 1920, height: 1080 }, // Microsoft Store, Snap Store
};

const D = {
  directory: { title: "Every directory, one search.", sub: "Your contacts, your company's LDAP and Microsoft 365." },
  stats: { title: "Know why a call sounds bad.", sub: "Live statistics, explained in plain words." },
  orb: { title: "A voice you can see.", sub: "The orb follows the real audio level." },
  recordings: { title: "Replay any call.", sub: "Recorded on your device. Automatic, and easy to turn off." },
  accounts: { title: "All your lines at once.", sub: "UDP, TCP or TLS. SRTP. Certificates always checked." },
  shortcuts: { title: "Answer from any app.", sub: "Global shortcuts, even when ZePhone is minimised." },
  audio: { title: "Microphone, speaker and ringtone, apart.", sub: "Pick each one, and see which is really in use." },
};

export const SLIDES: Slide[] = [
  // ---- App Store, iPhone (the first two pictures are the pair of iphone-dna.tsx)
  { id: "iphone-03-directory", set: "iphone", kind: "iphone", theme: "dark", ...D.directory, screen: "phone-directory" },
  { id: "iphone-04-stats", set: "iphone", kind: "iphone", theme: "light", ...D.stats, screen: "phone-stats" },
  { id: "iphone-05-orb", set: "iphone", kind: "iphone", theme: "dark", ...D.orb, screen: "phone-call-active" },
  { id: "iphone-06-recordings", set: "iphone", kind: "iphone", theme: "light", ...D.recordings, screen: "phone-recordings" },
  { id: "iphone-07-accounts", set: "iphone", kind: "iphone", theme: "dark", ...D.accounts, screen: "phone-accounts" },

  // ---- App Store, iPad
  { id: "ipad-01-hero", set: "ipad", kind: "ipad", theme: "light", title: "Your SIP line, on iPad.", sub: "Bring your own server. No account, no ads.", screen: "pad-history", icon: true },
  { id: "ipad-02-directory", set: "ipad", kind: "ipad", theme: "dark", ...D.directory, screen: "pad-directory" },
  { id: "ipad-03-stats", set: "ipad", kind: "ipad", theme: "light", ...D.stats, screen: "pad-stats" },
  { id: "ipad-04-accounts", set: "ipad", kind: "ipad", theme: "dark", ...D.accounts, screen: "pad-accounts" },

  // ---- Mac App Store
  { id: "mac-01-hero", set: "mac", kind: "mac", theme: "light", title: "Your SIP line, on your Mac.", sub: "Bring your own server. No account, no ads.", screen: "mac-history", icon: true },
  { id: "mac-02-directory", set: "mac", kind: "mac", theme: "dark", ...D.directory, screen: "mac-directory" },
  { id: "mac-03-stats", set: "mac", kind: "mac", theme: "light", ...D.stats, screen: "mac-history", scene: { main: "mac-history", call: "callwin-stats" } },
  { id: "mac-04-shortcuts", set: "mac", kind: "mac", theme: "dark", ...D.shortcuts, screen: "mac-shortcuts" },
  { id: "mac-05-audio", set: "mac", kind: "mac", theme: "light", ...D.audio, screen: "mac-audio" },

  // ---- Google Play, phone (also Samsung Galaxy Store, Huawei AppGallery, Aptoide)
  { id: "android-01-hero", set: "android", kind: "android", theme: "light", title: "Your SIP line, on Android.", sub: "Bring your own server. No account, no ads.", screen: "phone-call-active" },
  { id: "android-02-directory", set: "android", kind: "android", theme: "dark", ...D.directory, screen: "phone-directory" },
  { id: "android-03-stats", set: "android", kind: "android", theme: "light", ...D.stats, screen: "phone-stats" },
  { id: "android-04-orb", set: "android", kind: "android", theme: "dark", ...D.orb, screen: "phone-call-incoming" },
  { id: "android-05-recordings", set: "android", kind: "android", theme: "light", ...D.recordings, screen: "phone-recordings" },
  { id: "android-06-accounts", set: "android", kind: "android", theme: "dark", ...D.accounts, screen: "phone-accounts" },

  // ---- Google Play, 10" tablet
  { id: "tablet-01-hero", set: "tablet", kind: "tablet", theme: "light", title: "Your SIP line, on your tablet.", sub: "Bring your own server. No account, no ads.", screen: "tab-history" },
  { id: "tablet-02-directory", set: "tablet", kind: "tablet", theme: "dark", ...D.directory, screen: "tab-directory" },
  { id: "tablet-03-stats", set: "tablet", kind: "tablet", theme: "light", ...D.stats, screen: "tab-stats" },

  // ---- Microsoft Store, Snap Store, Linux: pictures of the desktop application
  { id: "desktop-01-hero", set: "desktop", kind: "desktop", theme: "light", title: "Your SIP line, on your desktop.", sub: "Windows, macOS and Linux. Bring your own server.", screen: "mac-history", scene: { main: "mac-history", call: "callwin-active" } },
  { id: "desktop-02-directory", set: "desktop", kind: "desktop", theme: "dark", ...D.directory, screen: "mac-directory", scene: { main: "mac-directory", call: "callwin-active" } },
  { id: "desktop-03-stats", set: "desktop", kind: "desktop", theme: "light", ...D.stats, screen: "mac-history", scene: { main: "mac-history", call: "callwin-stats" } },
  { id: "desktop-04-shortcuts", set: "desktop", kind: "desktop", theme: "dark", ...D.shortcuts, screen: "mac-shortcuts", scene: { main: "mac-shortcuts", call: "callwin-active" } },
];
