import { loadFont } from "@remotion/google-fonts/Geist";

/** The look of the store images: ZePhone is minimal, so the pictures are too (the colours of the app's two themes). */
export const colors = {
  background: "#fafafa", // the app's own light background
  ink: "#0a0a0a",
  muted: "#737373",
  line: "#e5e5e5",
  green: "#00a152", // the Call button
};

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
/** Geist, with a loud fallback: if the font ever fails to load, the pictures show it instead of silently using Helvetica. */
export const font = `${fontFamily}, "Courier New", monospace`;

export type Theme = "light" | "dark";

/**
 * Light: the colours of the app's light theme. Dark: its dark theme. The dots of the dithered sonar (shad-fx "rings") are drawn
 * clearly off the background so they read as a pattern, not a smudge.
 */
export const palette = (theme: Theme) =>
  theme === "light"
    ? {
        bg: "#fafafa",
        ink: "#0a0a0a",
        muted: "#6b6b70",
        dots: [168, 168, 180] as [number, number, number],
        desk: "#ececef",
        shadow: "rgba(10,10,20,0.20)",
        glass: "rgba(255,255,255,0.62)",
        glassEdge: "rgba(255,255,255,0.9)",
        glassLine: "rgba(10,10,20,0.08)",
        chip: "rgba(10,10,20,0.05)",
      }
    : {
        bg: "#0b0b0c",
        ink: "#fafafa",
        muted: "#a1a1a8",
        dots: [96, 96, 112] as [number, number, number],
        desk: "#161618",
        shadow: "rgba(0,0,0,0.65)",
        glass: "rgba(36,36,40,0.58)",
        glassEdge: "rgba(255,255,255,0.16)",
        glassLine: "rgba(255,255,255,0.10)",
        chip: "rgba(255,255,255,0.07)",
      };
