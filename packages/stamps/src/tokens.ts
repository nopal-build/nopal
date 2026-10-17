// packages/stamps/src/tokens.ts
//
// Typed lookup tables over the CSS custom properties `webapp/app/styles/
// root.css`'s `:root` block declares. Three tiers, same ones root.css
// itself is organized into now:
//
//   1. `palette`        — raw values, nature-themed families (on brand for
//                          a company named after the prickly pear cactus),
//                          each on a full 100–900 scale. Only specific
//                          rungs per family are "real" (referenced by a
//                          `colors` alias or `semanticColors` token below
//                          — see root.css's own comment above each family
//                          for which); the rest are generated tints/
//                          shades for a broader working palette during
//                          development, not meant to be reached for over
//                          a semantic token.
//   2. `colors`         — literal color-name aliases onto specific palette
//                          rungs (`purple` === `plum` 700, etc.) — kept for
//                          shorthand/memory ("purple" is faster to say/
//                          recall than "plum-700"), not because they're
//                          "more correct."
//   3. `semanticColors` — role-based tokens (`textSubtle`, `surfaceCard`,
//                          …). PREFER THESE in new component code — each
//                          one already resolves correctly for the current
//                          color scheme (the underlying CSS variable flips
//                          value inside root.css's dark-mode `@media`
//                          block), so consumers never need their own
//                          `@media (prefers-color-scheme: dark)` override
//                          just to pick the right color.
//
// Import from here instead of writing `"var(--purple)"` inline: a typo'd
// key (`palette.plum[750]`, `colors.pruple`) is a TypeScript error
// surfaced immediately by `tsc`/the `diagnostics` tool, where a typo'd CSS
// variable name (`var(--pruple)`) would silently resolve to nothing at
// runtime.
//
// Deliberately NOT using vanilla-extract's `createGlobalTheme` to
// generate these `:root` declarations (yet) — root.css remains the single
// source of truth for the actual values so the whole app (migrated and
// not-yet-migrated alike) keeps seeing identical colors. Once more of the
// app has moved onto `stamps`, the declarations themselves can move here
// too without any of these exported names changing.
export const palette = {
  plum: {
    100: "var(--plum-100)",
    200: "var(--plum-200)",
    300: "var(--plum-300)",
    400: "var(--plum-400)",
    500: "var(--plum-500)",
    600: "var(--plum-600)",
    700: "var(--plum-700)",
    800: "var(--plum-800)",
    900: "var(--plum-900)",
  },
  cactus: {
    100: "var(--cactus-100)",
    200: "var(--cactus-200)",
    300: "var(--cactus-300)",
    400: "var(--cactus-400)",
    500: "var(--cactus-500)",
    600: "var(--cactus-600)",
    700: "var(--cactus-700)",
    800: "var(--cactus-800)",
    900: "var(--cactus-900)",
  },
  clay: {
    100: "var(--clay-100)",
    200: "var(--clay-200)",
    300: "var(--clay-300)",
    400: "var(--clay-400)",
    500: "var(--clay-500)",
    600: "var(--clay-600)",
    700: "var(--clay-700)",
    800: "var(--clay-800)",
    900: "var(--clay-900)",
  },
  dune: {
    100: "var(--dune-100)",
    200: "var(--dune-200)",
    300: "var(--dune-300)",
    400: "var(--dune-400)",
    500: "var(--dune-500)",
    600: "var(--dune-600)",
    700: "var(--dune-700)",
    800: "var(--dune-800)",
    900: "var(--dune-900)",
  },
  bloom: {
    100: "var(--bloom-100)",
    200: "var(--bloom-200)",
    300: "var(--bloom-300)",
    400: "var(--bloom-400)",
    500: "var(--bloom-500)",
    600: "var(--bloom-600)",
    700: "var(--bloom-700)",
    800: "var(--bloom-800)",
    900: "var(--bloom-900)",
  },
  moonlight: {
    100: "var(--moonlight-100)",
    200: "var(--moonlight-200)",
    300: "var(--moonlight-300)",
    400: "var(--moonlight-400)",
    500: "var(--moonlight-500)",
    600: "var(--moonlight-600)",
    700: "var(--moonlight-700)",
    800: "var(--moonlight-800)",
    900: "var(--moonlight-900)",
  },
  surface: {
    day: {
      100: "var(--surface-day-100)",
      300: "var(--surface-day-300)",
      500: "var(--surface-day-500)",
    },
    night: {
      100: "var(--surface-night-100)",
      300: "var(--surface-night-300)",
      500: "var(--surface-night-500)",
    },
  },
  white: "var(--white)",
} as const;

export const colors = {
  white: "var(--white)",
  purple: "var(--purple)",
  purpleLight: "var(--purple-light)",
  pink: "var(--pink)",
  yellow: "var(--yellow)",
  yellowLight: "var(--yellow-light)",
  green: "var(--green)",
  greenLight: "var(--green-light)",
  red: "var(--red)",
  redLight: "var(--red-light)",
  moon: "var(--moon)",

  // Neutral surface aliases — prefer `semanticColors.surface*` in new
  // code; these map 1:1 onto the DAY scene only (no night pair), same as
  // they always have.
  farground: "var(--farground)",
  midground: "var(--midground)",
  foreground: "var(--foreground)",
  darkFarground: "var(--dark-farground)",
  darkMidground: "var(--dark-midground)",
  darkForeground: "var(--dark-foreground)",
} as const;

export const semanticColors = {
  textPrimary: "var(--color-text-primary)",
  textBrand: "var(--color-text-brand)",
  textSubtle: "var(--color-text-subtle)",
  textDanger: "var(--color-text-danger)",
  surfacePage: "var(--color-surface-page)",
  surfaceCard: "var(--color-surface-card)",
  surfaceInset: "var(--color-surface-inset)",
  surfaceBorder: "var(--color-surface-border)",

  // Same day/night inversion as `surfaceCard`/`surfaceBorder` — see the
  // comment above `--color-field-bg` in root.css.
  fieldBg: "var(--color-field-bg)",
  fieldBorder: "var(--color-field-border)",
  fieldText: "var(--color-field-text)",

  navActiveBg: "var(--color-nav-active-bg)",
  // A more vibrant, brand-blue alternative to `navActiveBg` -- for
  // `navLink`'s own `tone: "website"` (see `navLink.css.ts`), the public
  // marketing site's current-page highlight. Resolves to the `moonlight`
  // palette family (pale blue/lavender, `--moon` is its own 500 rung) --
  // a deeper rung in dark mode (see root.css) since the paler one is
  // already what ordinary (non-active) nav link TEXT renders in under
  // dark mode (`--color-text-brand`), and would otherwise wash out
  // against itself.
  navActiveAccentBg: "var(--color-nav-active-accent-bg)",
} as const;

// Mirrors `webapp/tailwind.config.ts`'s `fontFamily` — kept here too so
// recipes that need a font stack don't have to reach back into Tailwind
// config (the whole point is for `stamps` consumers to need zero Tailwind
// knowledge at all).
export const fonts = {
  // Variable font (single `wght` axis, 100–700) — the `@font-face` (see
  // both apps' `tailwind.css`) declares that whole range under this exact
  // family name, so any numeric `font-weight` in between renders its own
  // real interpolated weight instead of snapping to a static instance.
  sans: '"OT L22 Variable", -apple-system, BlinkMacSystemFont, sans-serif',
  serif: '-apple-system-ui-serif, ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
  hand: '"Indie Flower", cursive',
} as const;

export const darkModeMediaQuery = "(prefers-color-scheme: dark)";

// The one responsive breakpoint currently in use anywhere in the design
// system (AppLayout's desktop-topbar/mobile-nav split). Named, not a
// magic number, so it isn't silently duplicated/drifted the next time
// something else needs to switch layouts at the same point. Add more
// named breakpoints here — lazily, like everything else in this file —
// only once something else actually needs one.
export const breakpoints = {
  navMin: "860px",
  navMax: "859px",
} as const;
