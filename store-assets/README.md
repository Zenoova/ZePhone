# Store images

The preview images of the stores (App Store, Mac App Store, Google Play, Microsoft Store…), drawn as React compositions and
rendered as still PNGs with [Remotion](https://www.remotion.dev) (free for a company of up to three people: see its licence).

Every picture shows the **real application**, with invented data, in the light or the dark theme, on the device of the platform,
with real pieces of the interface (a contact's card, the plain-words reading of a call, the orb picker, the accounts list with
the little faces) floating over it. The shad-fx "rings" run behind all of them.

- `src/components/mockups/`: device frames (MacBook from [STARCK UI](https://ui.starck.studio), iPhone and Android from
  [Magic UI](https://magicui.design), iPad from [Eldora UI](https://www.eldoraui.site)), `src/components/dna-carousel.tsx` from
  [creative-ui](https://ui.krutikraut.com) (a 3D carousel), `src/components/shad-fx/` from [shad-fx](https://www.sekei.design/shad-fx)
  (dithered effects). All are MIT-style shadcn components copied in. Geist from Google Fonts at render time. The Windows laptop,
  window and taskbar (`src/compositions/devices.tsx`) are drawn here, with no Microsoft artwork.
- `src/slides.ts`: the list of pictures (platform, theme, title, screen, floating cards) and of the **pairs** (two pictures drawn as one
  panorama and cut in two: a helix of screens, or two laptops, runs across the seam). `src/compositions/`: how they are laid out.
- The logo on the pictures is the two companions of `public/logo.svg`, with no background (the Icon Composer icon always has its tile).
- `scripts/render-all.mjs`: renders every picture to `out/<set>/`, at the exact size of the store. `scripts/contact-sheet.mjs`: one
  contact sheet per set in `out/_sheets/`, to review a set at a glance.

## Where the screens come from

| Script | What it photographs |
|---|---|
| `scripts/capture.mjs` | the desktop UI, the Android phone and tablet layouts: the Vite dev server with `?mock=showcase` (tidy fake data, no SIP), in Chrome |
| `scripts/capture-cards.mjs` | the pieces that float: orb picker, accounts list, a contact's card, the incoming-call window |
| `scripts/capture-orbs.mjs` | the 14 voice orbs, one transparent PNG each (the real shaders) |
| `scripts/sim-shot.sh`, `sim-series.sh`, `sim-series-ipad.sh` | the **iPhone and iPad in the iOS Simulator**, so the navigation bar is the system's own Liquid Glass one |

The Simulator runs the real application shell, whose page is served by `scripts/sim-proxy.mjs`: a wrapper page with the showcase
application in a frame (the shell freezes its bridge in the page it loads, so the fake backend can only be installed in a frame, and
it passes the tab bar commands through to the real shell). `src/dev/mock-scenes.ts` puts the application in a state through the
address (`section=history`, `tab=General`, `scene=call`, `scene=stats`, `open=contact`).

```bash
npm install
npm --prefix .. run dev                              # the app on :1420, in another terminal
node scripts/capture.mjs                             # desktop + Android layouts, light and dark (about 10 minutes)
node scripts/capture-cards.mjs && node scripts/capture-orbs.mjs

# iPhone and iPad (Xcode with the iOS 26 simulators; the app is built once against the proxy)
node scripts/sim-proxy.mjs &                         # port 1500 → Vite
echo '{"build":{"devUrl":"http://localhost:1500","beforeDevCommand":null}}' > /tmp/ios-dev.json
(cd .. && PATH="/opt/homebrew/opt/rustup/bin:$PATH" npm run tauri ios dev -- "iPhone 17 Pro Max" --config /tmp/ios-dev.json)
#   (if the CLI picks another runtime than the booted simulator, install the built ZePhone.app on the booted one with `xcrun simctl install`)
#   clean status bar: xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4
SIM=<iphone-udid> scripts/sim-series.sh              # turn the iPad to landscape first for the next one
SIM=<ipad-udid> scripts/sim-series-ipad.sh

node scripts/stage.mjs                               # every capture into public/ (the iPad's window handle is painted over)
for p in iOS macOS; do for r in Default Dark; do     # the Icon Composer icon, light and dark (App Store listing, not on the pictures)
  "/Applications/Icon Composer.app/Contents/Executables/ictool" ../src-tauri/icons/ZePhone.icon --export-image \
    --output-file public/icon-$(echo $p | tr A-Z a-z)-$(echo $r | tr A-Z a-z).png --platform $p --rendition $r --width 1024 --height 1024 --scale 1
done; done
node scripts/render-all.mjs                          # every picture, in out/<set>/ (about 15 minutes)
node scripts/contact-sheet.mjs                       # one sheet per set, in out/_sheets/
node scripts/pack-upload.mjs                         # out/upload/: one folder per store slot, checked against the store's rules
```

The compositions wait for their images, the font and the shader effect (a few seconds) before the frame is taken. Sizes the stores ask for are in
`docs/STORE-LISTING.md`.
