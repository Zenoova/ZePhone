import { Composition } from "remotion";
import { MacHero } from "./compositions/MacHero";
import { PhonePair } from "./compositions/PhonePair";
import { FeatureGraphic } from "./compositions/FeatureGraphic";

// Each store image is a composition; the frame is chosen when rendering (the snapcn frames fade their screen in).
const base = { fps: 30, durationInFrames: 90 };

export const Root = () => (
  <>
    <Composition id="mac-hero" component={MacHero} width={2880} height={1800} {...base} />
    <Composition id="phone-pair" component={PhonePair} width={2640} height={2868} {...base} />
    <Composition id="feature-graphic" component={FeatureGraphic} width={2048} height={1000} {...base} />
  </>
);
