import { Blobatar } from "@blobatar/react";
import type { CSSProperties, ReactNode } from "react";
import { staticFile } from "remotion";
import { font, palette, type Theme } from "../theme";

/** A capture of the real app, in the given theme. */
export const shotUrl = (name: string, theme: Theme) => staticFile(`${name}-${theme}.png`);

/** The logo (the two companions): no background, white on the dark theme. */
export const Logo = ({ theme, size, style }: { theme: Theme; size: number; style?: CSSProperties }) => (
  <img
    src={staticFile("logo.svg")}
    style={{ display: "block", width: size, height: size, filter: theme === "dark" ? "invert(1)" : undefined, ...style }}
  />
);

/**
 * Frosted glass, as the iOS 26 controls: translucent, blurred, with a bright edge on top and a soft shadow underneath.
 * `strong` makes it a card (big shadow), otherwise it is a pill or a chip.
 */
export const glass = (theme: Theme, radius: number, strong = true): CSSProperties => {
  const p = palette(theme);
  return {
    background: p.glass,
    backdropFilter: "blur(28px) saturate(1.7)",
    WebkitBackdropFilter: "blur(28px) saturate(1.7)",
    border: `1px solid ${p.glassLine}`,
    boxShadow: `inset 0 1.5px 0 ${p.glassEdge}, 0 ${strong ? radius * 0.5 : radius * 0.25}px ${strong ? radius * 1.6 : radius * 0.8}px ${p.shadow}`,
    borderRadius: radius,
  };
};

/**
 * A piece of a capture, floating as a card: `crop` is [x, y, w, h] in fractions of the capture, `aspect` the width / height of
 * the whole capture. Everything is in px of the picture.
 */
export const Shot = ({
  src,
  aspect,
  crop,
  width,
  radius,
  theme,
  style,
}: {
  src: string;
  aspect: number;
  crop: [number, number, number, number];
  width: number;
  radius: number;
  theme: Theme;
  style?: CSSProperties;
}) => {
  const [x, y, w, h] = crop;
  const full = width / w;
  const height = (full / aspect) * h;
  const p = palette(theme);
  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: p.bg,
        boxShadow: `0 0 0 1px ${p.glassLine}, 0 ${radius * 0.6}px ${radius * 2}px ${p.shadow}`,
        ...style,
      }}
    >
      <img src={src} style={{ position: "absolute", width: full, left: -x * full, top: -(y * full) / aspect, maxWidth: "none" }} />
    </div>
  );
};

/** The face of a SIP account: the same little blobatar the app draws from the account's address. */
export const Face = ({ seed, size, status, ring }: { seed: string; size: number; status?: "ok" | "off"; ring?: string }) => (
  <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
    <Blobatar name={seed} size={size} />
    {status && (
      <i
        style={{
          position: "absolute",
          right: -size * 0.02,
          bottom: -size * 0.02,
          width: size * 0.26,
          height: size * 0.26,
          borderRadius: "50%",
          background: status === "ok" ? "#00a152" : "#a3a3a3",
          boxShadow: `0 0 0 ${size * 0.045}px ${ring ?? "#fafafa"}`,
        }}
      />
    )}
  </span>
);

/** One of the 14 voice orbs of the app (a capture of the real shader, transparent around the ball). */
export const Orb = ({ id, size, style }: { id: string; size: number; style?: CSSProperties }) => (
  <img src={staticFile(`orbs/${id}.png`)} style={{ position: "absolute", width: size, height: size, ...style }} />
);

/** A small pill: a label with an optional dot. */
export const Chip = ({ theme, size, children, dot, style }: { theme: Theme; size: number; children: ReactNode; dot?: string; style?: CSSProperties }) => {
  const p = palette(theme);
  return (
    <span
      style={{
        ...glass(theme, size * 1.2, false),
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.52}px ${size * 1.05}px`,
        fontFamily: font,
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        color: p.ink,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && <i style={{ width: size * 0.5, height: size * 0.5, borderRadius: "50%", background: dot }} />}
      {children}
    </span>
  );
};

/** Title and sub-title, with the logo above when asked. `unit` is the width of the picture. */
export const Header = ({
  theme,
  unit,
  title,
  sub,
  logo,
  left,
  top,
  width,
  align = "center",
  titleScale = 0.095,
  subScale = 0.036,
  logoScale = 0.17,
}: {
  theme: Theme;
  unit: number;
  title: string;
  sub?: string;
  logo?: boolean;
  left?: number;
  top: number;
  width?: number;
  align?: "center" | "left";
  titleScale?: number;
  subScale?: number;
  logoScale?: number;
}) => {
  const p = palette(theme);
  const box: CSSProperties =
    align === "center" ? { left: 0, right: 0, textAlign: "center" } : { left: left ?? 0, width, textAlign: "left" };
  return (
    <div style={{ position: "absolute", top, ...box, fontFamily: font, color: p.ink }}>
      {logo && (
        <Logo
          theme={theme}
          size={unit * logoScale}
          style={{ margin: align === "center" ? `0 auto ${unit * logoScale * 0.04}px` : `0 0 ${unit * logoScale * 0.04}px -${unit * logoScale * 0.09}px` }}
        />
      )}
      <div
        style={{
          fontSize: unit * titleScale,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 1.03,
          padding: align === "center" ? `0 ${unit * 0.05}px` : 0,
          textWrap: "balance",
        } as CSSProperties}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontSize: unit * subScale,
            fontWeight: 400,
            color: p.muted,
            letterSpacing: "-0.012em",
            lineHeight: 1.3,
            marginTop: unit * subScale * 0.8,
            padding: align === "center" ? `0 ${unit * 0.09}px` : 0,
            textWrap: "balance",
          } as CSSProperties}
        >
          {sub}
        </div>
      )}
    </div>
  );
};
