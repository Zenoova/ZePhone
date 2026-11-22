import type { CSSProperties, ReactNode } from "react";
import { staticFile } from "remotion";
import { font, palette, type Theme } from "../theme";

/** A capture of the real app, in the given theme. */
export const shotUrl = (name: string, theme: Theme) => staticFile(`${name}-${theme}.png`);

export const iconUrl = (theme: Theme, platform: "ios" | "macos") => staticFile(`icon-${platform}-${theme === "light" ? "default" : "dark"}.png`);

/** Title, sub-title and the Icon Composer icon, centred at the top of a picture. `unit` is the width of the picture. */
export const Header = ({
  theme,
  unit,
  title,
  sub,
  icon,
  platform,
  top,
  titleScale = 0.095,
  subScale = 0.036,
  iconScale = 0.16,
}: {
  theme: Theme;
  unit: number;
  title: string;
  sub?: string;
  icon?: boolean;
  platform: "ios" | "macos";
  top: number;
  titleScale?: number;
  subScale?: number;
  iconScale?: number;
}) => {
  const p = palette(theme);
  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center", fontFamily: font, color: p.ink }}>
      {icon && <img src={iconUrl(theme, platform)} style={{ display: "block", margin: `0 auto ${unit * iconScale * 0.22}px`, width: unit * iconScale, height: unit * iconScale }} />}
      <div style={{ fontSize: unit * titleScale, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.04, padding: `0 ${unit * 0.06}px`, textWrap: "balance" } as CSSProperties}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: unit * subScale, fontWeight: 400, color: p.muted, letterSpacing: "-0.012em", marginTop: unit * 0.028, padding: `0 ${unit * 0.1}px`, textWrap: "balance" } as CSSProperties}>
          {sub}
        </div>
      )}
    </div>
  );
};

/** A faux desktop with no wallpaper: the main window and, in front, the call window, as they sit on a real screen. */
export const DesktopScene = ({
  theme,
  main,
  call,
  width,
  height,
  rounded = 0,
  fill = 1,
}: {
  theme: Theme;
  main: string;
  call: string;
  width: number;
  height: number;
  rounded?: number;
  /** 1 on the screen of a laptop (windows keep some air); bigger when the scene is a panel of its own. */
  fill?: number;
}) => {
  const p = palette(theme);
  const winH = height * 0.7 * fill;
  const mainW = winH * (1180 / 756);
  const callH = height * 0.8 * fill;
  const callW = callH * (440 / 760);
  const total = mainW + callW * 0.62;
  const left = (width - total) / 2;
  const win = (w: number, h: number, x: number, y: number, src: string): ReactNode => (
    <img
      src={src}
      style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: h * 0.028, boxShadow: `0 ${h * 0.03}px ${h * 0.09}px ${p.shadow}`, objectFit: "cover" }}
    />
  );
  return (
    <div style={{ position: "relative", width, height, background: p.desk, borderRadius: rounded, overflow: "hidden" }}>
      {win(mainW, winH, left, height * (fill > 1 ? 0.06 : 0.1), shotUrl(main, theme))}
      {win(callW, callH, left + mainW - callW * 0.38, height * (fill > 1 ? 0.02 : 0.1), shotUrl(call, theme))}
    </div>
  );
};

/** A plain tablet: a black bezel round the capture (no brand: Android tablets have none in common). */
export const TabletFrame = ({ src, width }: { src: string; width: number }) => {
  const bezel = width * 0.022;
  return (
    <div style={{ width, aspectRatio: "1.6", background: "#141416", borderRadius: width * 0.032, padding: bezel, boxSizing: "border-box", boxShadow: "0 40px 90px rgba(0,0,0,0.22)" }}>
      <img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", borderRadius: width * 0.014, display: "block" }} />
    </div>
  );
};
