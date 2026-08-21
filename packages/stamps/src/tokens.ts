// packages/stamps/src/tokens.ts
//
// Typed lookup tables over the CSS custom properties `webapp/app/styles/
// root.css`'s `:root` block declares. Three tiers, same ones root.css
// itself is organized into now:
//
//   1. `palette`        — raw values, nature-themed families (on brand for
//                          a company named after the prickly pear cactus)
//                          on a 100–900 scale, populated lazily.
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
    200: "var(--plum-200)",
    300: "var(--plum-300)",
    400: "var(--plum-400)",
    700: "var(--plum-700)",
  },
  cactus: {
    300: "var(--cactus-300)",
    500: "var(--cactus-500)",
  },
  clay: {
    300: "var(--clay-300)",
    500: "var(--clay-500)",
  },
  dune: {
    300: "var(--dune-300)",
    500: "var(--dune-500)",
  },
  bloom: {
    500: "var(--bloom-500)",
  },
  moonlight: {
    500: "var(--moonlight-500)",
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
  surfaceBorder: "var(--color-surface-border)",

  // Form fields deliberately don't follow the day/night surface swap —
  // see the comment above `--color-field-bg` in root.css.
  fieldBg: "var(--color-field-bg)",
  fieldBorder: "var(--color-field-border)",
  fieldText: "var(--color-field-text)",
} as const;

// Mirrors `webapp/tailwind.config.ts`'s `fontFamily` — kept here too so
// recipes that need a font stack don't have to reach back into Tailwind
// config (the whole point is for `stamps` consumers to need zero Tailwind
// knowledge at all).
export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, sans-serif',
  serif: '-apple-system-ui-serif, ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
  hand: '"Indie Flower", cursive',
} as const;

export const darkModeMediaQuery = "(prefers-color-scheme: dark)";
