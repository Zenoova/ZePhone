import { loadFont } from "@remotion/google-fonts/Geist";

/** The look of the store images: ZePhone is minimal, so the pictures are too (the colours of the app's light theme). */
export const colors = {
  background: "#fafafa", // the app's own light background
  ink: "#0a0a0a",
  muted: "#737373",
  line: "#e5e5e5",
  green: "#00a152", // the Call button
};

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
/** Geist, with a loud fallback: if the font ever fails to load, the pictures show it instead of silently using Helvetica. */
export const font = `${fontFamily}, "Courier New", monospace`;

export type Theme = "light" | "dark";

/** Light: the colours of the app's light theme. Dark: its dark theme. The dots of the dithered sonar sit just off the background. */
export const palette = (theme: Theme) =>
  theme === "light"
    ? { bg: "#fafafa", ink: "#0a0a0a", muted: "#737373", dots: [224, 224, 224] as [number, number, number], desk: "#ececef", shadow: "rgba(0,0,0,0.18)" }
    : { bg: "#0b0b0c", ink: "#fafafa", muted: "#a3a3a3", dots: [36, 36, 38] as [number, number, number], desk: "#161618", shadow: "rgba(0,0,0,0.6)" };
