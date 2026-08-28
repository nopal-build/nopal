// packages/stamps/src/input.css.ts
//
// Port of `.input-component` from webapp's `root.css`, plus the Tailwind
// utility classes `Input.tsx` used to layer on top of it — `flex flex-col`
// on the wrapper, `border border-gray-300 rounded px-2 py-1` on the field
// itself (all three of which were already fully overridden in practice by
// `.input-component`'s higher-specificity descendant selector — dead
// weight, not carried over here), `sr-only` on the label when hidden.
import { style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const wrapper = style({
  display: "flex",
  flexDirection: "column",
});

export const label = recipe({
  base: {
    color: semanticColors.textPrimary,
    fontWeight: 700,
  },
  variants: {
    // Visually hides the label while keeping it in the DOM for screen
    // readers — the standard "sr-only" technique, since that's a
    // Tailwind utility class and this component shouldn't need Tailwind.
    hidden: {
      true: {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      },
    },
  },
});

export const field = recipe({
  base: {
    outline: "none",
    border: `1px solid ${semanticColors.fieldBorder}`,
    borderRadius: 8,
    background: semanticColors.fieldBg,
    color: semanticColors.fieldText,
    selectors: {
      "&:focus": {
        borderColor: colors.pink,
      },
    },
  },
  variants: {
    // Native `date`/`number` control chrome (the calendar icon, segmented
    // date parts, and up/down spin buttons) needs more vertical room than
    // plain text to render without clipping or overflowing the rounded
    // border at the default padding/height — see `compact` below.
    density: {
      normal: {
        padding: "16px 8px",
        maxHeight: 40,
      },
      compact: {
        padding: 8,
        maxHeight: 42,
      },
    },
    multiline: {
      true: { minHeight: 130 },
    },
  },
  defaultVariants: {
    density: "normal",
  },
});

export type LabelVariants = RecipeVariants<typeof label>;
export type FieldVariants = RecipeVariants<typeof field>;
