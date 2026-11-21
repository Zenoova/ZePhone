# zephone.zenoova.com

Static site (English only): plain HTML and CSS, no build step. Serve this folder as the root of
`zephone.zenoova.com`. The pages are linked without `.html` (`/privacy`, `/support`), so the host must serve
`privacy.html` for `/privacy` (GitHub Pages, Cloudflare Pages and Netlify do this; on Vercel set `cleanUrls`).

The store listings use `https://zephone.zenoova.com/privacy` as the privacy policy and
`https://zephone.zenoova.com/support` as the support URL. Keep `privacy.html` in line with `docs/PRIVACY.md`.
