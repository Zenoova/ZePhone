import type { CSSProperties, ReactNode } from "react";
import { staticFile } from "remotion";
import { Android } from "../components/mockups/android";
import { Ipad } from "../components/mockups/ipad";
import { Iphone } from "../components/mockups/iphone";
import { MacbookMockup } from "../components/mockups/macbook-mockup";
import { font, palette, type Theme } from "../theme";
import { shotUrl } from "./ui";

/** Aspect ratios (width / height) of the devices, so a layout can place them before they are drawn. */
export const RATIO = { iphone: 433 / 882, android: 380 / 830, ipad: 520 / 400, tablet: 1.6, mac: 1792 / 1165, win: 1.6 / (1 + 0.075) };

const shadow = (theme: Theme, w: number, k = 0.04): CSSProperties => ({
  filter: `drop-shadow(0 ${w * k * 0.6}px ${w * k * 1.2}px ${palette(theme).shadow})`,
});

/** An iPhone (Magic UI) or an Android phone, the screen filled with a capture. */
export const PhoneDevice = ({ kind, theme, src, width }: { kind: "iphone" | "android"; theme: Theme; src: string; width: number }) => (
  <div className={theme === "dark" ? "dark" : ""} style={{ width, ...shadow(theme, width, 0.05) }}>
    {kind === "iphone" ? <Iphone src={src} style={{ width: "100%" }} /> : <Android src={src} style={{ width: "100%", height: "auto", display: "block" }} />}
  </div>
);

/** An iPad (Eldora UI). */
export const PadDevice = ({ theme, src, width }: { theme: Theme; src: string; width: number }) => (
  <div className={theme === "dark" ? "dark" : ""} style={{ width, ...shadow(theme, width, 0.03) }}>
    <Ipad src={src} style={{ width: "100%", height: "auto", display: "block" }} />
  </div>
);

/** An Android tablet: a plain black bezel round the capture (no brand: Android tablets have none in common). */
export const TabletDevice = ({ theme, src, width }: { theme: Theme; src: string; width: number }) => {
  const bezel = width * 0.022;
  return (
    <div
      style={{
        width,
        aspectRatio: "1.6",
        background: "#141416",
        borderRadius: width * 0.032,
        padding: bezel,
        boxSizing: "border-box",
        ...shadow(theme, width, 0.03),
      }}
    >
      <img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", borderRadius: width * 0.014, display: "block" }} />
    </div>
  );
};

/** A MacBook (STARCK): `children` fill the screen, which is 1.54 : 1. */
export const MacDevice = ({ theme, width, children }: { theme: Theme; width: number; children: ReactNode }) => (
  <div style={{ width, ...shadow(theme, width, 0.025) }}>
    <MacbookMockup expandable={false} frameSrc={staticFile("macbook-frame.webp")}>
      {children}
    </MacbookMockup>
  </div>
);

/** The little windows 11 style glyphs of the taskbar and the title bar, drawn here (no brand artwork needed). */
const Squares = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16">
    {[0, 1].flatMap((i) => [0, 1].map((j) => <rect key={`${i}${j}`} x={i * 8.4} y={j * 8.4} width={7.2} height={7.2} rx={0.8} fill={color} />))}
  </svg>
);

/** A Windows 11 application window: title bar with the caption buttons, then the capture of the app. */
export const WinWindow = ({
  theme,
  src,
  left,
  top,
  width,
  height,
  s,
  title = "ZePhone",
  z = 1,
}: {
  theme: Theme;
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** px per px of a 1920-wide screen. */
  s: number;
  title?: string;
  z?: number;
}) => {
  const p = palette(theme);
  const bar = 34 * s;
  const stroke = theme === "light" ? "#202024" : "#f0f0f4";
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        zIndex: z,
        borderRadius: 9 * s,
        overflow: "hidden",
        background: p.bg,
        boxShadow: `0 0 0 ${1 * s}px ${p.glassLine}, 0 ${18 * s}px ${48 * s}px ${p.shadow}`,
      }}
    >
      <div style={{ height: bar, display: "flex", alignItems: "center", justifyContent: "space-between", background: theme === "light" ? "#f3f3f5" : "#1c1c20", fontFamily: font }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 * s, paddingLeft: 12 * s, fontSize: 12.5 * s, color: stroke }}>
          <img src={staticFile("logo.svg")} style={{ width: 17 * s, height: 17 * s, filter: theme === "dark" ? "invert(1)" : undefined }} />
          {title}
        </div>
        <div style={{ display: "flex", height: "100%" }}>
          {["min", "max", "close"].map((k) => (
            <div key={k} style={{ width: 46 * s, display: "grid", placeItems: "center" }}>
              <svg width={10 * s} height={10 * s} viewBox="0 0 10 10" fill="none" stroke={stroke} strokeWidth={1}>
                {k === "min" && <path d="M0 5h10" />}
                {k === "max" && <rect x="0.5" y="0.5" width="9" height="9" rx="1" />}
                {k === "close" && <path d="M0 0l10 10M10 0L0 10" />}
              </svg>
            </div>
          ))}
        </div>
      </div>
      <img src={src} style={{ display: "block", width: "100%", height: height - bar, objectFit: "cover", objectPosition: "top" }} />
    </div>
  );
};

/** The taskbar of Windows 11: icons in the middle, the system tray and the clock on the right. */
const Taskbar = ({ theme, s }: { theme: Theme; s: number }) => {
  const dark = theme === "dark";
  const ink = dark ? "#f0f0f4" : "#202024";
  const h = 46 * s;
  const tile = (bg: string, active = false) => (
    <span style={{ position: "relative", width: 30 * s, height: 30 * s, borderRadius: 7 * s, background: bg, display: "inline-block" }}>
      {active && <i style={{ position: "absolute", left: "50%", bottom: -5 * s, width: 14 * s, height: 3 * s, borderRadius: 3 * s, background: "#3b82f6", transform: "translateX(-50%)" }} />}
    </span>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: h,
        background: dark ? "rgba(32,32,38,0.86)" : "rgba(243,243,247,0.86)",
        backdropFilter: "blur(20px)",
        borderTop: `${1 * s}px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"}`,
        fontFamily: font,
        color: ink,
        zIndex: 50,
      }}
    >
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12 * s }}>
        <Squares size={24 * s} color="#3b82f6" />
        <span style={{ width: 150 * s, height: 28 * s, borderRadius: 14 * s, background: dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)", display: "inline-block" }} />
        {tile(dark ? "#3a3a42" : "#d8d8de")}
        {tile(dark ? "#3a3a42" : "#d8d8de")}
        <span style={{ position: "relative", width: 30 * s, height: 30 * s, display: "grid", placeItems: "center", borderRadius: 7 * s, background: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)" }}>
          <img src={staticFile("logo.svg")} style={{ width: 22 * s, height: 22 * s, filter: dark ? "invert(1)" : undefined }} />
          <i style={{ position: "absolute", left: "50%", bottom: -5 * s, width: 14 * s, height: 3 * s, borderRadius: 3 * s, background: "#3b82f6", transform: "translateX(-50%)" }} />
        </span>
        {tile(dark ? "#3a3a42" : "#d8d8de")}
      </div>
      <div style={{ position: "absolute", right: 14 * s, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 14 * s, fontSize: 11.5 * s }}>
        <svg width={16 * s} height={16 * s} viewBox="0 0 16 16" fill="none" stroke={ink} strokeWidth={1.4} strokeLinecap="round">
          <path d="M1.5 6a9.5 9.5 0 0 1 13 0M3.8 8.6a6.2 6.2 0 0 1 8.4 0M6.1 11.2a3 3 0 0 1 3.8 0" />
          <circle cx="8" cy="13.4" r="0.6" fill={ink} />
        </svg>
        <svg width={16 * s} height={16 * s} viewBox="0 0 16 16" fill="none" stroke={ink} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6h2.5L8 3v10l-3.5-3H2zM10.6 5.6a3.4 3.4 0 0 1 0 4.8" />
        </svg>
        <svg width={20 * s} height={16 * s} viewBox="0 0 20 16" fill="none" stroke={ink} strokeWidth={1.4}>
          <rect x="1" y="4" width="15" height="8" rx="2" />
          <path d="M18 7v2" strokeLinecap="round" />
          <rect x="2.6" y="5.6" width="9" height="4.8" rx="0.8" fill={ink} stroke="none" />
        </svg>
        <div style={{ textAlign: "right", lineHeight: 1.25 }}>
          <div>9:41 AM</div>
          <div>11/23/2026</div>
        </div>
      </div>
    </div>
  );
};

/**
 * A Windows 11 desktop on a 16 : 10 screen: a quiet wallpaper, the taskbar, and the windows of ZePhone the caller gives
 * (positions are in px of a 1920 × 1200 screen).
 */
export const WinDesktop = ({
  theme,
  width,
  windows,
}: {
  theme: Theme;
  width: number;
  windows: Array<{ src: string; x: number; y: number; w: number; h: number; title?: string }>;
}) => {
  const s = width / 1920;
  const dark = theme === "dark";
  return (
    <div
      style={{
        position: "relative",
        width,
        height: width / 1.6,
        overflow: "hidden",
        background: dark
          ? "radial-gradient(120% 90% at 20% 0%, #23232b 0%, #121216 60%)"
          : "radial-gradient(120% 90% at 20% 0%, #f4f5f9 0%, #dfe2ea 70%)",
      }}
    >
      {windows.map((w, i) => (
        <WinWindow key={i} theme={theme} src={w.src} left={w.x * s} top={w.y * s} width={w.w * s} height={w.h * s} s={s} title={w.title} z={i + 1} />
      ))}
      <Taskbar theme={theme} s={s} />
    </div>
  );
};

/** A Windows laptop: thin bezels, a webcam, a flat silver base. `children` is the screen (1.6 : 1). */
export const WinLaptop = ({ theme, width, children }: { theme: Theme; width: number; children: ReactNode }) => {
  const bez = width * 0.011;
  const screenW = width - bez * 2;
  return (
    <div style={{ width, ...shadow(theme, width, 0.025) }}>
      <div style={{ position: "relative", background: "#0e0e10", borderRadius: `${width * 0.018}px ${width * 0.018}px 0 0`, padding: `${bez * 1.35}px ${bez}px ${bez}px`, boxShadow: "inset 0 0 0 1px #3a3a40" }}>
        <i style={{ position: "absolute", top: bez * 0.5, left: "50%", width: bez * 0.4, height: bez * 0.4, borderRadius: "50%", background: "#2a2a30", transform: "translateX(-50%)" }} />
        <div style={{ width: screenW, height: screenW / 1.6, overflow: "hidden", borderRadius: width * 0.004 }}>{children}</div>
      </div>
      <div
        style={{
          position: "relative",
          left: "-3%",
          width: "106%",
          height: width * 0.02,
          borderRadius: `0 0 ${width * 0.02}px ${width * 0.02}px`,
          background: theme === "dark" ? "linear-gradient(#5a5a62,#3c3c42)" : "linear-gradient(#e4e4ea,#b4b4bc)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <i style={{ position: "absolute", left: "50%", top: 0, width: "14%", height: "46%", borderRadius: `0 0 ${width * 0.01}px ${width * 0.01}px`, background: theme === "dark" ? "#2a2a30" : "#9a9aa4", transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
};

export { shotUrl };
