# Arc UI components

Components of [Arc UI](https://uiarc.dev) (free tier, MIT), copied as source the way
`npx shadcn@latest add @uiarc/<name>` would (from `https://uiarc.dev/r/<name>.json`):
`button`, `dropdown-menu`, `switch`, `input`, `dialog`, `select`, `tabs`, `tooltip`, `badge`, `avatar`, `popover`.

## Changes from upstream

- **Tokens are prefixed.** Arc's design tokens (`--background`, `--foreground`, `--border`, `--accent`, …) have the
  same names as the ones the rest of the app uses, so every custom property defined by `foundation.css` is renamed
  `--arc-<name>` in `foundation.css` and in the components. `foundation.css` is imported once, in `src/main.tsx`;
  `data-theme` (light/dark) is set by `next-themes` and `data-accent="blue"` by `main.tsx`.
- The global `:focus` / `:focus-visible` rules at the end of `foundation.css` are dropped: they would restyle the
  focus of the whole app.
- `@radix-ui/react-*` imports come from the unified `radix-ui` package; `lucide-react` icons come from
  `@/components/icons` (the animated AnimateIcons set).
- `tabs`: translucent, blurred list and selection pill (instead of the opaque surface), like the other glass surfaces.
- `dropdown-menu`: an optional `trigger` prop, to open the menu from an icon button.

The folder is excluded from ESLint and Prettier so it stays diffable against upstream.
