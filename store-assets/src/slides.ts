/**
 * Every store picture. One entry = one PNG: `out/<set>/<id>.png`. Each screen is a capture of the real app (the iOS and iPadOS ones
 * come from the Simulator, with the system's own Liquid Glass tab bar), in the theme of the slide.
 *
 * What the pictures say is what the app really does (README, "Features"): a directory that joins local contacts, LDAP and
 * Microsoft 365; statistics that explain a bad call in plain words; a voice orb to pick among 14; a little face (companion) for
 * every account; global shortcuts; separate microphone, speaker and ringtone; local recordings.
 */
export type Theme = "light" | "dark";
export type Kind = "iphone" | "android" | "ipad" | "tablet" | "mac" | "desktop";

/** A piece of a capture floating over the device: `crop` is [x, y, w, h] in fractions of the capture. */
export interface CardSpec {
  /** Capture name without the theme suffix. */
  src: string;
  /** Width / height of the whole capture. */
  aspect: number;
  crop: [number, number, number, number];
  /** Left and top as fractions of the picture, width as a fraction of its width. */
  x: number;
  y: number;
  w: number;
  rot?: number;
  radius?: number;
  /** Frame the card as glass (translucent) instead of an opaque screen. */
  z?: number;
}

export interface ChipSpec {
  text: string;
  x: number;
  y: number;
  dot?: string;
  rot?: number;
}

export type Recipe = "device" | "orbs" | "faces" | "features";

export interface Slide {
  id: string;
  set: string;
  kind: Kind;
  theme: Theme;
  recipe: Recipe;
  title: string;
  sub?: string;
  /** The logo (two companions) above the title. */
  logo?: boolean;
  /** Capture shown on the device, without the theme suffix. */
  screen?: string;
  /** A desktop scene (main window + call window) instead of one capture. */
  scene?: { main: string; call: string };
  /** Text on the left, the device on the right (landscape pictures). */
  split?: boolean;
  cards?: CardSpec[];
  chips?: ChipSpec[];
}

/** A pair of pictures drawn as one panorama (twice the width), then cut in two: what runs across the seam links them. */
export interface Pair {
  id: string;
  set: string;
  kind: Kind;
  theme: Theme;
  titleA: string;
  titleB: string;
  /** Captures (without the theme suffix) shown around the seam. */
  screens: string[];
  /** The two file names of the halves. */
  files: [string, string];
  /** Windows laptops instead of a carousel. */
  twin?: { a: { main: string; call: string }; b: { main: string; call: string } };
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
  directory: { title: "Every directory, one search.", sub: "Your contacts, your company's LDAP and Microsoft 365, in one list." },
  stats: { title: "Know why a call sounds bad.", sub: "Live statistics, explained in plain words." },
  orbs: { title: "Give every call a voice.", sub: "14 living orbs that follow the real audio level." },
  faces: { title: "Every line has a face.", sub: "A little companion for each account, with its live status." },
  recordings: { title: "Replay any call.", sub: "Recorded on your device only. Easy to turn off." },
  accounts: { title: "All your lines at once.", sub: "UDP, TCP or TLS. SRTP. Certificates always checked." },
  features: { title: "Built for work, not just for dialling.", sub: "Everything a modern SIP phone should do." },
  shortcuts: { title: "Answer from any app.", sub: "Global shortcuts, even when ZePhone is minimised." },
  audio: { title: "Microphone, speaker and ringtone, apart.", sub: "Pick each one, and see which is really in use." },
};

// Aspect ratios of the captures the cards are cut from.
const A = { ios: 1320 / 2868, pad: 2752 / 2064, mac: 1180 / 756, win: 440 / 760, android: 430 / 932 };

/** The contact's card, the plain-words reading and the recording player, cut out of the phone captures. */
const phoneCards = {
  contact: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "ios-contact", aspect: A.ios, crop: [0.035, 0.352, 0.93, 0.54], x, y, w, rot, radius: 70 }),
  reading: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "ios-stats", aspect: A.ios, crop: [0.04, 0.49, 0.92, 0.215], x, y, w, rot, radius: 60 }),
  chart: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "ios-stats", aspect: A.ios, crop: [0.04, 0.715, 0.92, 0.22], x, y, w, rot, radius: 60 }),
  player: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "ios-recordings", aspect: A.ios, crop: [0.04, 0.15, 0.92, 0.2], x, y, w, rot, radius: 60 }),
};

/** Pieces of the desktop captures, for the landscape pictures. */
const wideCards = {
  contact: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "card-contact", aspect: 1800 / 1236, crop: [0, 0, 1, 1], x, y, w, rot, radius: 60 }),
  reading: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "callwin-stats", aspect: 440 / 760, crop: [0.085, 0.535, 0.83, 0.285], x, y, w, rot, radius: 50 }),
  shortcuts: (x: number, y: number, w: number, rot = 0): CardSpec => ({ src: "mac-shortcuts", aspect: A.mac, crop: [0.215, 0.31, 0.57, 0.27], x, y, w, rot, radius: 50 }),
};

export const SLIDES: Slide[] = [
  // ---- App Store, iPhone (the first two pictures are the pair below)
  { id: "iphone-03-directory", set: "iphone", kind: "iphone", theme: "dark", recipe: "device", ...D.directory, screen: "ios-directory", cards: [phoneCards.contact(0.12, 0.555, 0.84, 2.5)], chips: [{ text: "Acme directory (LDAP)", x: 0.04, y: 0.455, dot: "#3b82f6" }, { text: "Microsoft 365", x: 0.62, y: 0.405, dot: "#00a152", rot: 3 }] },
  { id: "iphone-04-stats", set: "iphone", kind: "iphone", theme: "light", recipe: "device", ...D.stats, screen: "ios-stats", cards: [phoneCards.reading(0.06, 0.62, 0.88, -2)], chips: [{ text: "Opus · 48 kHz", x: 0.045, y: 0.352, dot: "#00a152", rot: -2 }, { text: "Wi-Fi, VPN or router?", x: 0.5, y: 0.575, dot: "#f59e0b", rot: 2 }] },
  { id: "iphone-05-orbs", set: "iphone", kind: "iphone", theme: "dark", recipe: "orbs", ...D.orbs },
  { id: "iphone-06-faces", set: "iphone", kind: "iphone", theme: "light", recipe: "faces", ...D.faces },
  { id: "iphone-07-recordings", set: "iphone", kind: "iphone", theme: "dark", recipe: "device", ...D.recordings, screen: "ios-recordings", cards: [phoneCards.player(0.08, 0.7, 0.86, -2.5)], chips: [{ text: "Stored on this device", x: 0.05, y: 0.43, dot: "#00a152" }] },
  { id: "iphone-08-features", set: "iphone", kind: "iphone", theme: "light", recipe: "features", ...D.features, logo: true },

  // ---- App Store, iPad
  { id: "ipad-03-directory", set: "ipad", kind: "ipad", theme: "dark", recipe: "device", ...D.directory, screen: "ipad-directory", split: true, cards: [wideCards.contact(0.27, 0.6, 0.27, 2)], chips: [{ text: "Acme directory (LDAP)", x: 0.05, y: 0.62, dot: "#3b82f6" }, { text: "Microsoft 365", x: 0.05, y: 0.7, dot: "#00a152" }] },
  { id: "ipad-04-stats", set: "ipad", kind: "ipad", theme: "light", recipe: "device", ...D.stats, screen: "ipad-stats", cards: [wideCards.reading(0.03, 0.6, 0.27, -2)] },
  { id: "ipad-05-orbs", set: "ipad", kind: "ipad", theme: "dark", recipe: "orbs", ...D.orbs },
  { id: "ipad-06-features", set: "ipad", kind: "ipad", theme: "light", recipe: "features", ...D.features, logo: true },

  // ---- Mac App Store
  { id: "mac-03-directory", set: "mac", kind: "mac", theme: "dark", recipe: "device", ...D.directory, screen: "mac-directory", split: true, cards: [wideCards.contact(0.27, 0.6, 0.27, 2)] },
  { id: "mac-04-stats", set: "mac", kind: "mac", theme: "light", recipe: "device", ...D.stats, screen: "mac-history", scene: { main: "mac-history", call: "callwin-stats" }, cards: [wideCards.reading(0.03, 0.6, 0.23, -2)] },
  { id: "mac-05-orbs", set: "mac", kind: "mac", theme: "dark", recipe: "orbs", ...D.orbs },
  { id: "mac-06-faces", set: "mac", kind: "mac", theme: "light", recipe: "faces", ...D.faces },
  { id: "mac-07-shortcuts", set: "mac", kind: "mac", theme: "dark", recipe: "device", ...D.shortcuts, screen: "mac-shortcuts", split: true, cards: [wideCards.shortcuts(0.27, 0.6, 0.27, -2)] },
  { id: "mac-08-audio", set: "mac", kind: "mac", theme: "light", recipe: "device", ...D.audio, screen: "mac-audio" },
  { id: "mac-09-features", set: "mac", kind: "mac", theme: "dark", recipe: "features", ...D.features, logo: true },

  // ---- Google Play, phone (also Samsung Galaxy Store, Huawei AppGallery, Aptoide)
  { id: "android-03-directory", set: "android", kind: "android", theme: "dark", recipe: "device", ...D.directory, screen: "phone-directory" },
  { id: "android-04-stats", set: "android", kind: "android", theme: "light", recipe: "device", ...D.stats, screen: "phone-stats", cards: [phoneCards.reading(0.06, 0.62, 0.88, -2)], chips: [{ text: "Opus · 48 kHz", x: 0.045, y: 0.352, dot: "#00a152", rot: -2 }, { text: "Wi-Fi, VPN or router?", x: 0.5, y: 0.575, dot: "#f59e0b", rot: 2 }] },
  { id: "android-05-orbs", set: "android", kind: "android", theme: "dark", recipe: "orbs", ...D.orbs },
  { id: "android-06-faces", set: "android", kind: "android", theme: "light", recipe: "faces", ...D.faces },
  { id: "android-07-recordings", set: "android", kind: "android", theme: "dark", recipe: "device", ...D.recordings, screen: "phone-recordings" },
  { id: "android-08-features", set: "android", kind: "android", theme: "light", recipe: "features", ...D.features, logo: true },

  // ---- Google Play, 10" tablet
  { id: "tablet-03-directory", set: "tablet", kind: "tablet", theme: "dark", recipe: "device", ...D.directory, screen: "tab-directory", split: true, cards: [wideCards.contact(0.27, 0.6, 0.27, 2)] },
  { id: "tablet-04-stats", set: "tablet", kind: "tablet", theme: "light", recipe: "device", ...D.stats, screen: "tab-stats", cards: [wideCards.reading(0.03, 0.6, 0.25, -2)] },
  { id: "tablet-05-orbs", set: "tablet", kind: "tablet", theme: "dark", recipe: "orbs", ...D.orbs },

  // ---- Microsoft Store, Snap Store, Linux: the desktop application on a Windows PC
  { id: "desktop-03-directory", set: "desktop", kind: "desktop", theme: "dark", recipe: "device", ...D.directory, scene: { main: "mac-directory", call: "callwin-active" }, split: true, cards: [wideCards.contact(0.27, 0.62, 0.27, 2)] },
  { id: "desktop-04-stats", set: "desktop", kind: "desktop", theme: "light", recipe: "device", ...D.stats, scene: { main: "mac-history", call: "callwin-stats" }, cards: [wideCards.reading(0.03, 0.62, 0.22, -2)] },
  { id: "desktop-05-orbs", set: "desktop", kind: "desktop", theme: "dark", recipe: "orbs", ...D.orbs },
  { id: "desktop-06-shortcuts", set: "desktop", kind: "desktop", theme: "light", recipe: "device", ...D.shortcuts, scene: { main: "mac-shortcuts", call: "callwin-incoming" }, split: true, cards: [wideCards.shortcuts(0.27, 0.62, 0.27, -2)] },
  { id: "desktop-07-features", set: "desktop", kind: "desktop", theme: "dark", recipe: "features", ...D.features, logo: true },
];

export const PAIRS: Pair[] = [
  { id: "iphone-pair", set: "iphone", kind: "iphone", theme: "light", titleA: "Your SIP line,", titleB: "on iPhone.", screens: ["ios-call", "ios-recordings", "ios-incoming", "ios-accounts", "ios-history", "ios-directory"], files: ["iphone-01-hero", "iphone-02-hero"] },
  { id: "ipad-pair", set: "ipad", kind: "ipad", theme: "light", titleA: "Your SIP line,", titleB: "on iPad.", screens: ["ipad-call", "ipad-history", "ipad-directory", "ipad-accounts", "ipad-recordings", "ipad-stats"], files: ["ipad-01-hero", "ipad-02-hero"] },
  { id: "mac-pair", set: "mac", kind: "mac", theme: "light", titleA: "Your SIP line,", titleB: "on your Mac.", screens: ["mac-history", "mac-directory", "mac-orbs", "mac-recordings", "mac-accounts", "mac-contact"], files: ["mac-01-hero", "mac-02-hero"] },
  { id: "android-pair", set: "android", kind: "android", theme: "light", titleA: "Your SIP line,", titleB: "on Android.", screens: ["phone-call-active", "phone-recordings", "phone-call-incoming", "phone-accounts", "phone-history", "phone-directory"], files: ["android-01-hero", "android-02-hero"] },
  { id: "tablet-pair", set: "tablet", kind: "tablet", theme: "light", titleA: "Your SIP line,", titleB: "on your tablet.", screens: ["tab-history", "tab-directory", "tab-stats", "tab-history", "tab-directory", "tab-stats"], files: ["tablet-01-hero", "tablet-02-hero"] },
  { id: "desktop-pair", set: "desktop", kind: "desktop", theme: "light", titleA: "Your SIP line,", titleB: "on your PC.", screens: [], files: ["desktop-01-hero", "desktop-02-hero"], twin: { a: { main: "mac-history", call: "callwin-active" }, b: { main: "mac-directory", call: "callwin-stats" } } },
];
