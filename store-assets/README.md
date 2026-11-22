# Store images

The preview images of the stores (App Store, Mac App Store, Google Play), drawn as React compositions and rendered as
still PNGs with [Remotion](https://www.remotion.dev) (free for a company of up to three people: see its licence).

- `src/components/mockups/`: device frames (MacBook from [STARCK UI](https://ui.starck.studio), iPhone and Android from
  [Magic UI](https://magicui.design), iPad from [Eldora UI](https://www.eldoraui.site)), `src/components/dna-carousel.tsx` from
  [creative-ui](https://ui.krutikraut.com) (a 3D carousel), `src/components/shad-fx/` from [shad-fx](https://www.sekei.design/shad-fx)
  (dithered effects). All are MIT-style shadcn components copied in. Geist from Google Fonts at render time.
- `scripts/capture.mjs`: photographs the **real interface** of the app (the Vite dev server with `?mock=showcase`: tidy fake data,
  no SIP) with the Chrome of the Mac, in the light and the dark theme. Nothing in the pictures is drawn by hand.
- `src/compositions/`: one file per picture; `src/Root.tsx` lists them with their size.
- `scripts/render-all.mjs`: renders every picture of `src/slides.ts` (and the iPhone pair, and the Play graphic) to `out/<set>/`, at the exact size of the store.
- `scripts/contact-sheet.mjs`: one contact sheet per set in `out/_sheets/`, to review a set at a glance.
- `public/icon-*.png`: the Icon Composer icon, exported with `ictool` (see the first lines of `docs/STORE-LISTING.md`, "Images").

```bash
npm install
npm --prefix .. run dev                    # the app on :1420, in another terminal
node scripts/capture.mjs && cp captures/*.png public/
npx remotion still src/index.ts mac-hero out/mac-hero.png --frame=0 --gl=angle
npx remotion still src/index.ts iphone-dna out/iphone-dna.png --frame=0 --gl=angle
node scripts/render-all.mjs            # everything, in out/\nnode scripts/contact-sheet.mjs         # then look at out/_sheets/
```

The compositions wait for their images, the font and the shader effect (a few seconds) before the frame is taken. Sizes the stores ask for are in
`docs/STORE-LISTING.md`.
