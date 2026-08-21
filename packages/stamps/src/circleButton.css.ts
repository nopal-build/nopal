// packages/stamps/src/circleButton.css.ts
//
// Port of `.circle-btn`/`.circle-btn-green`/`.circle-btn-red` from
// webapp's `root.css`. The base variant folds entirely onto semantic
// tokens with no `@media` override needed at all — `textSubtle`,
// `surfaceBorder`, and `textPrimary` already resolve correctly per scheme
// on their own (see tokens.ts). `green`/`red` intentionally stay on the
// literal palette: both already read fine in both color schemes without
// a night pair (see the original CSS comments this was ported from).
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const circleButton = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    border: "none",
    background: "none",
    cursor: "pointer",
    color: semanticColors.textSubtle,
    transition: "background 150ms, color 150ms",
    flexShrink: 0,
    selectors: {
      "&:hover, &:focus-visible, &[data-active='true']": {
        background: semanticColors.surfaceBorder,
        color: semanticColors.textPrimary,
      },
      "&:focus-visible": {
        outline: `2px solid ${colors.purpleLight}`,
        outlineOffset: "2px",
      },
      "&:disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
    },
  },
  variants: {
    // Solid-fill green — e.g. an "add attachment" affordance that needs
    // to read as actionable at rest, not just on hover.
    variant: {
      default: {},
      green: {
        background: colors.green,
        color: "white",
        selectors: {
          "&:hover, &:focus-visible, &[data-active='true']": {
            background: colors.green,
            color: "white",
            filter: "brightness(1.1)",
          },
        },
      },
      // Transparent-at-rest, red-tinted-on-hover — a "remove this"
      // affordance (see OxRenderer's file/card directive close buttons).
      // A transparent 1px border at rest reserves the same space the
      // hover border needs, so hovering doesn't shift anything by a
      // pixel.
      red: {
        color: colors.red,
        border: "1px solid transparent",
        boxSizing: "border-box",
        selectors: {
          "&:hover, &:focus-visible, &[data-active='true']": {
            background: colors.redLight,
            borderColor: colors.red,
            color: colors.red,
          },
        },
      },
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type CircleButtonVariants = RecipeVariants<typeof circleButton>;
