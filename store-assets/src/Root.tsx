import { Composition } from "remotion";
import { IPHONE_PANORAMA, IphoneDna } from "./compositions/IphoneDna";
import { PLAY_FEATURE, PlayFeature } from "./compositions/PlayFeature";
import { Slide } from "./compositions/Slide";
import { SIZES, SLIDES } from "./slides";

// Each store image is a composition; the render waits for the fonts, the images and the shader before taking the frame.
const base = { fps: 30, durationInFrames: 30 };

export const Root = () => (
  <>
    {SLIDES.map((slide) => (
      <Composition key={slide.id} id={slide.id} component={Slide} defaultProps={{ slide }} {...SIZES[slide.kind]} {...base} />
    ))}
    <Composition id="iphone-dna-light" component={IphoneDna} defaultProps={{ theme: "light" as const }} {...IPHONE_PANORAMA} {...base} />
    <Composition id="play-feature" component={PlayFeature} {...PLAY_FEATURE} {...base} />
  </>
);
