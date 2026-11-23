import { Composition } from "remotion";
import { PairSlide, pairSize } from "./compositions/Pair";
import { PLAY_FEATURE, PlayFeature } from "./compositions/PlayFeature";
import { Slide } from "./compositions/Slide";
import { PAIRS, SIZES, SLIDES } from "./slides";

// Each store image is a composition; the render waits for the fonts, the images and the shader effect before taking the frame.
const base = { fps: 30, durationInFrames: 30 };

export const Root = () => (
  <>
    {SLIDES.map((slide) => (
      <Composition key={slide.id} id={slide.id} component={Slide} defaultProps={{ slide }} {...SIZES[slide.kind]} {...base} />
    ))}
    {PAIRS.map((pair) => (
      <Composition key={pair.id} id={pair.id} component={PairSlide} defaultProps={{ pair }} {...pairSize(pair.kind)} {...base} />
    ))}
    <Composition id="play-feature" component={PlayFeature} {...PLAY_FEATURE} {...base} />
  </>
);
