// packages/stamps/src/button.css.ts
//
// Port of `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-outline`/
// `.btn-purple`/`.btn-yellow` from webapp's `root.css`. Not Tailwind (it's
// already custom CSS), but exactly the kind of shared, everywhere-used
// primitive that belongs in `stamps` rather than a global class.
//
// Exported as a raw recipe (`button(...)`), not a fixed `<Button>`
// component — same reasoning as `Surface`'s `surfaceBase`/`navLink`:
// call sites apply `.btn-*` to `<button>`, `<a>`, AND `<Link>`
// polymorphically today, so a single fixed element type would be a step
// backward.
//
// `.btn-outline` deliberately does NOT get `display: inline-flex` /
// `border-radius: 8px` the other four variants share — it never did (it
// "stands alone" in the original CSS, see the style guide's own note on
// this), bringing its own padding at every call site.
//
// `tint: "danger"` replaces the old `style={{ "--btn-color": "var(--red)" }}`
// escape hatch (only ever used on `secondary`, e.g. revoke/suspend/deny
// actions) with a real, typed variant — the whole point of moving off a
// bare CSS custom property nobody's typo on it would ever be caught.
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, darkModeMediaQuery } from "./tokens";

export const button = recipe({
  variants: {
    variant: {
      primary: {
        display: "inline-flex",
        borderRadius: 8,
        background: colors.purple,
        padding: "16px 32px",
        color: "white",
        whiteSpace: "nowrap",
        "@media": {
          [darkModeMediaQuery]: {
            background: "white",
            color: colors.purple,
          },
        },
      },
      // Same as `primary` minus the baked-in padding — for callers that
      // need to control sizing themselves (see the original `.btn-purple`
      // in root.css).
      purple: {
        display: "inline-flex",
        borderRadius: 8,
        background: colors.purple,
        color: "white",
        whiteSpace: "nowrap",
        "@media": {
          [darkModeMediaQuery]: {
            background: "white",
            color: colors.purple,
          },
        },
      },
      secondary: {
        display: "inline-flex",
        borderRadius: 8,
        background: colors.green,
        padding: "8px 16px",
        color: "white",
      },
      yellow: {
        display: "inline-flex",
        borderRadius: 8,
        background: colors.farground,
        border: `1px solid ${colors.foreground}`,
        padding: "8px 16px",
        color: colors.purpleLight,
        "@media": {
          [darkModeMediaQuery]: {
            background: colors.darkFarground,
            borderColor: colors.darkForeground,
            color: "white",
          },
        },
      },
      outline: {
        border: `1px solid ${colors.midground}`,
        borderRadius: 4,
        "@media": {
          [darkModeMediaQuery]: {
            borderColor: colors.darkMidground,
          },
        },
      },
    },
    // Only meaningful on `secondary` today (the only variant the old
    // `--btn-color` override was ever actually used on) — declared after
    // `variant` so its background wins the cascade tie when both classes
    // are applied together.
    tint: {
      danger: {
        background: colors.red,
      },
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export type ButtonVariants = RecipeVariants<typeof button>;
