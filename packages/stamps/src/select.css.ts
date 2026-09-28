// packages/stamps/src/select.css.ts
//
// The stamp dropdown (`Select.tsx`): the same field as `Input` (border,
// radius, colours, pink focus), with the browser's own arrow replaced by
// a chevron so it looks the same everywhere.
import { style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const selectWrapper = style({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  minWidth: 0,
});

export const selectField = recipe({
  base: {
    appearance: "none",
    WebkitAppearance: "none",
    outline: "none",
    width: "100%",
    minWidth: 0,
    font: "inherit",
    border: `1px solid ${semanticColors.fieldBorder}`,
    borderRadius: 8,
    background: semanticColors.fieldBg,
    color: semanticColors.fieldText,
    cursor: "pointer",
    selectors: {
      "&:focus": { borderColor: colors.pink },
      "&:disabled": { opacity: 0.5, cursor: "default" },
    },
  },
  variants: {
    size: {
      // Beside an `Input`: the same height.
      normal: { padding: "8px 32px 8px 8px", minHeight: 40 },
      // In a row of text (a person's group in a list).
      small: { padding: "2px 24px 2px 8px", fontSize: "0.8rem", borderRadius: 6 },
    },
  },
  defaultVariants: { size: "normal" },
});

export const chevron = recipe({
  base: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    color: semanticColors.textSubtle,
    pointerEvents: "none",
  },
  variants: {
    size: {
      normal: { right: 10 },
      small: { right: 7 },
    },
  },
  defaultVariants: { size: "normal" },
});

export type SelectFieldVariants = RecipeVariants<typeof selectField>;
