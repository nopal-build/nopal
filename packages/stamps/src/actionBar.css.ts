// packages/stamps/src/actionBar.css.ts
//
// Backs `ActionBar`/`ActionBarGroup`/`ActionBarButton` -- a small toolbar
// of icon buttons, some visually joined into a shared-border "group"
// (matching the split-editor mockup's own expand+flip pill), some
// standalone (still rendered as their own one-button group, so every
// button gets the identical border/radius/hover treatment regardless of
// whether it's grouped with a sibling). `3px` radius throughout, per
// this whole affordance's own design note (distinct from the `6px`
// `DrawerContent`'s own toggle buttons use elsewhere -- these are a
// smaller, denser control).
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const bar = style({
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

export const group = style({
  display: "flex",
  alignItems: "stretch",
  border: `1px solid ${semanticColors.surfaceBorder}`,
  borderRadius: "3px",
  overflow: "hidden",
  background: semanticColors.surfaceCard,
});

// A divider between two buttons in the SAME group -- applied to every
// button but the first via `:not(:first-child)`, rather than needing the
// caller to insert its own separator elements between children.
export const button = recipe({
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // `minWidth`, not a fixed `width` -- an icon-only button (Expand, Flip
    // Layout) ends up square-ish since a 12px icon plus this padding lands
    // right around 26px either way, but a text-label button in the SAME
    // group (a mobile Preview/Markdown toggle) needs to grow with its own
    // content instead of clipping it.
    minWidth: "26px",
    height: "26px",
    flexShrink: 0,
    background: "none",
    border: "none",
    padding: "0 8px",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    color: semanticColors.textBrand,
    selectors: {
      "&:not(:first-child)": {
        borderLeft: `1px solid ${semanticColors.surfaceBorder}`,
      },
      "&:hover:not(:disabled)": {
        background: semanticColors.surfaceInset,
      },
      "&:disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
    },
  },
  variants: {
    // Same convention `navLink`'s own `active` variant already
    // established (`navActiveBg` + purple text) -- reused here rather
    // than `surfaceInset`, which was tried first and turned out to read
    // as barely-there against this bar's own similarly-toned card
    // background (confirmed directly: `getComputedStyle` showed the
    // "active" Preview button and a plain DISABLED, unrelated Save
    // button landing on the near-identical color by coincidence --
    // clearly not enough contrast for a real selected-state indicator).
    active: {
      true: { background: semanticColors.navActiveBg, color: colors.purple, fontWeight: 700 },
      false: {},
    },
  },
  defaultVariants: {
    active: false,
  },
});
