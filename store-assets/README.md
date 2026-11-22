# Store images

The preview images of the stores (App Store, Mac App Store, Google Play), drawn as React compositions and rendered as
still PNGs with [Remotion](https://www.remotion.dev) (free for a company of up to three people: see its licence).

- `src/components/snap-cn/`: device frames from [snapcn](https://snapcn.dev) (MIT), `src/components/dna-carousel.tsx` from
  [creative-ui](https://ui.krutikraut.com) (a 3D carousel), backdrops from [Paper Shaders](https://github.com/paper-design/shaders)
  (Apache-2.0), fonts from Google Fonts at render time.
- `scripts/capture.mjs`: photographs the **real interface** of the app (the Vite dev server with `?mock=showcase`: tidy fake data,
  no SIP) with the Chrome of the Mac. Nothing in the pictures is drawn by hand.
- `src/compositions/`: one file per picture; `src/Root.tsx` lists them with their size.
- `scripts/split.mjs`: cuts a double-width render into two App Store screenshots that continue each other.

```bash
npm install
npm --prefix .. run dev                    # the app on :1420, in another terminal
node scripts/capture.mjs && cp captures/*.png public/
npx remotion still src/index.ts mac-hero out/mac-hero.png --frame=40 --gl=angle
node scripts/split.mjs out/phone-pair.png out/ios-a out/ios-b
```

Render at frame 40: the frames fade their screen in during the first frames. Sizes the stores ask for are in
`docs/STORE-LISTING.md`.
