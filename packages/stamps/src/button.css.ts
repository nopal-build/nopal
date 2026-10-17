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
import { globalStyle } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, darkModeMediaQuery } from "./tokens";

export const button = recipe({
  // Applies to every variant — previously each call site had to
  // remember to bolt on its own `opacity-50 cursor-not-allowed` (or
  // equivalent), the exact kind of easy-to-forget, easy-to-typo styling
  // this recipe exists to make unnecessary. `disabled` is real HTML
  // state, not a variant prop, so this lives in `base` (always applied)
  // rather than as its own `variants` entry.
  base: {
    selectors: {
      "&:disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
    },
  },
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
      // A single, prominently-featured pill CTA -- e.g. a site header's
      // one "go here" nav item (see `webapp/app/components/
      // WebsiteHeader.tsx`, which treats whichever nav link is listed
      // LAST as this kind of callout). Solid, saturated yellow and fully
      // rounded, with a real soft drop shadow -- deliberately a SEPARATE
      // variant from the quieter, bordered `yellow` above (which reads as
      // a secondary/soft action) rather than a prop toggle on it, since
      // nothing else in this recipe asks for this much visual weight.
      callout: {
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 9999,
        background: colors.yellow,
        padding: "9px 22px",
        color: colors.purple,
        fontWeight: 600,
        whiteSpace: "nowrap",
        boxShadow: "1px 1px 1px rgb(109, 110, 153)",
        "@media": {
          [darkModeMediaQuery]: {
            background: colors.yellowLight,
            boxShadow: "0 3px 12px rgba(0, 0, 0, 0.4)",
          },
        },
      },
      // The quiet choice beside an action ("Pass", "No", "Keep them on"):
      // reads as a link, sits on the same baseline as the button next to
      // it, and never competes with it. The Maker's people rows built
      // this inline three times before it was a variant (2026-09-30).
      quiet: {
        display: "inline-flex",
        alignItems: "center",
        background: "none",
        border: 0,
        padding: 0,
        color: colors.purpleLight,
        textDecoration: "underline",
        textUnderlineOffset: 3,
        cursor: "pointer",
        "@media": {
          [darkModeMediaQuery]: {
            color: colors.darkForeground,
          },
        },
      },
    },
    // A row's action, not a page's: the size the Maker's people rows and
    // the Copy field use (`copyButton`), for a button that sits in a list
    // or beside text. Declared after `variant` so its padding wins the
    // tie with the variant's own.
    size: {
      compact: {
        padding: "6px 12px",
        fontSize: "0.75rem",
        lineHeight: 1.4,
        alignItems: "center",
      },
      // Shallower top/bottom padding ONLY -- left/right stays whatever
      // the variant itself already set (e.g. `callout`'s own 22px), since
      // this sets just `paddingTop`/`paddingBottom` (longhand), not the
      // `padding` shorthand. Declared after `variant` so these two
      // longhands win the cascade tie against the variant's own shorthand
      // `padding`, exactly like `compact` above, but without touching the
      // horizontal rhythm at all -- for a pill-shaped CTA that needs to
      // sit inline at nav-link height (e.g. a site header's featured
      // `callout`) without going as narrow/small-text as `compact`.
      thin: {
        paddingTop: 0,
        paddingBottom: 0,
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

// Force-scheme override for the Vault website editor's / the
// `/maker/stamps/scratch` guide's own light/dark PREVIEW toggle
// (`.website-preview-force-{light,dark}`, `website.css` in both
// `fruits`/`webapp`). That ancestor class works by plain custom-
// property inheritance for the tokens IT owns, but can't reach into
// each variant's `@media (prefers-color-scheme: dark)` block above --
// those set real literal colors directly on THIS recipe's own
// generated class, so nothing about an ancestor's override can be
// inherited over top of them. Re-declaring each variant's own colors
// here, scoped under the SAME force-toggle class, gives 3 classes of
// specificity (ancestor + the recipe's own base+variant classes) --
// enough to beat the 1-class `@media` rule above in EITHER direction,
// regardless of which one the browser's real query currently matches.
// `secondary` is deliberately absent -- it has no dark-mode swap above
// to fight, so it already reads correctly under either forced scheme.
function forceSchemeSelector(variant: "primary" | "purple" | "yellow" | "outline") {
  return `.${button({ variant }).trim().split(/\s+/).join(".")}`;
}

globalStyle(`.website-preview-force-light ${forceSchemeSelector("primary")}`, {
  background: colors.purple,
  color: "white",
});
globalStyle(`.website-preview-force-dark ${forceSchemeSelector("primary")}`, {
  background: "white",
  color: colors.purple,
});

globalStyle(`.website-preview-force-light ${forceSchemeSelector("purple")}`, {
  background: colors.purple,
  color: "white",
});
globalStyle(`.website-preview-force-dark ${forceSchemeSelector("purple")}`, {
  background: "white",
  color: colors.purple,
});

globalStyle(`.website-preview-force-light ${forceSchemeSelector("yellow")}`, {
  background: colors.farground,
  borderColor: colors.foreground,
  color: colors.purpleLight,
});
globalStyle(`.website-preview-force-dark ${forceSchemeSelector("yellow")}`, {
  background: colors.darkFarground,
  borderColor: colors.darkForeground,
  color: "white",
});

globalStyle(`.website-preview-force-light ${forceSchemeSelector("outline")}`, {
  borderColor: colors.midground,
});
globalStyle(`.website-preview-force-dark ${forceSchemeSelector("outline")}`, {
  borderColor: colors.darkMidground,
});
