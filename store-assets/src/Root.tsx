import { Composition } from "remotion";
import { IPHONE_PANORAMA, IphoneDna } from "./compositions/IphoneDna";
import { MacHero, macHeroSize } from "./compositions/MacHero";
import { PLAY_FEATURE, PlayFeature } from "./compositions/PlayFeature";

// Each store image is a composition; the render waits for the fonts and the shader before taking the frame.
const base = { fps: 30, durationInFrames: 30 };

export const Root = () => (
  <>
    <Composition id="mac-hero" component={MacHero} {...macHeroSize} {...base} />
    <Composition id="iphone-dna" component={IphoneDna} {...IPHONE_PANORAMA} {...base} />
    <Composition id="play-feature" component={PlayFeature} {...PLAY_FEATURE} {...base} />
  </>
);
