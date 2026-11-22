import { AbsoluteFill, staticFile } from "remotion";
import { Android } from "../components/mockups/android";
import { Ipad } from "../components/mockups/ipad";
import { Iphone } from "../components/mockups/iphone";
import { MacbookMockup } from "../components/mockups/macbook-mockup";
import { SIZES, type Slide as SlideSpec } from "../slides";
import { font, palette } from "../theme";
import { FxLayer } from "./FxLayer";
import { DesktopScene, Header, shotUrl, TabletFrame } from "./parts";
import { usePreload } from "./usePreload";

/** One store picture: a headline, and the real app on the device of the platform, in the theme of the slide. */
export const Slide = ({ slide }: { slide: SpecProps }) => {
  const s = slide;
  const { width: W, height: H } = SIZES[s.kind];
  const p = palette(s.theme);
  const urls = s.scene ? [shotUrl(s.scene.main, s.theme), shotUrl(s.scene.call, s.theme)] : [shotUrl(s.screen, s.theme)];
  usePreload([...urls, staticFile("macbook-frame.webp")]);
  const portrait = s.kind === "iphone" || s.kind === "android";
  const platform = s.kind === "mac" ? "macos" : "ios";
  const dark = s.theme === "dark" ? "dark" : "";

  return (
    <AbsoluteFill style={{ background: p.bg, fontFamily: font }}>
      <FxLayer origin={portrait ? [0.5, 0.78] : [0.5, 0.72]} cell={Math.max(3, Math.round(W / 650))} color={p.dots} />
      {portrait ? (
        <>
          <Header theme={s.theme} unit={W} title={s.title} sub={s.sub} icon={s.icon} platform={platform} top={H * 0.07} />
          <div className={dark} style={{ position: "absolute", left: W * 0.08, top: H * (s.kind === "iphone" ? 0.27 : 0.3), width: W * 0.84 }}>
            {s.kind === "iphone" ? (
              <Iphone src={urls[0]} style={{ width: "100%", filter: `drop-shadow(0 ${W * 0.02}px ${W * 0.04}px ${p.shadow})` }} />
            ) : (
              <Android src={urls[0]} style={{ width: "100%", height: "auto", filter: `drop-shadow(0 ${W * 0.02}px ${W * 0.04}px ${p.shadow})` }} />
            )}
          </div>
        </>
      ) : (
        <>
          <Header theme={s.theme} unit={W} title={s.title} sub={s.sub} icon={s.icon} platform={platform} top={H * (s.icon ? 0.05 : 0.085)} titleScale={s.kind === "desktop" ? 0.052 : 0.05} subScale={0.0215} iconScale={0.075} />
          {s.kind === "mac" && (
            <div style={{ position: "absolute", left: W * 0.15, top: H * (s.icon ? 0.38 : 0.31), width: W * 0.7 }}>
              <MacbookMockup expandable={false} frameSrc={staticFile("macbook-frame.webp")}>
                {s.scene ? (
                  <DesktopScene theme={s.theme} main={s.scene.main} call={s.scene.call} width={W * 0.7 * 0.778} height={W * 0.7 * 0.778 * (893 / 1394)} />
                ) : (
                  <img src={urls[0]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                )}
              </MacbookMockup>
            </div>
          )}
          {s.kind === "ipad" && (
            <div className={dark} style={{ position: "absolute", left: W * 0.17, top: H * (s.icon ? 0.38 : 0.3), width: W * 0.66, filter: `drop-shadow(0 ${W * 0.01}px ${W * 0.025}px ${p.shadow})` }}>
              <Ipad src={urls[0]} style={{ width: "100%", height: "auto" }} />
            </div>
          )}
          {s.kind === "tablet" && (
            <div style={{ position: "absolute", left: W * 0.19, top: H * 0.31 }}>
              <TabletFrame src={urls[0]} width={W * 0.62} />
            </div>
          )}
          {s.kind === "desktop" && s.scene && (
            <div style={{ position: "absolute", left: W * 0.13, top: H * 0.3, width: W * 0.74, height: H * 0.66 }}>
              <DesktopScene theme={s.theme} main={s.scene.main} call={s.scene.call} width={W * 0.74} height={H * 0.66} rounded={H * 0.02} fill={1.22} />
            </div>
          )}
        </>
      )}
    </AbsoluteFill>
  );
};

type SpecProps = SlideSpec;
