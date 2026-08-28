// packages/stamps/src/menuItem.css.ts
//
// Port of `.menu-item` from webapp's `root.css` — a row inside a
// dropdown/action-menu panel (see `MoreMenu`). Folds the caller's old
// `"menu-item text-sm" + (item.danger ? "red-text" : "purple-text")`
// class composition into a single `danger` variant instead.
import { recipe } from "@vanilla-extract/recipes";
import { semanticColors } from "./tokens";

export const menuItem = recipe({
  base: {
    display: "block",
    width: "100%",
    textAlign: "left",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: "0.875rem", // Tailwind's `text-sm`
    transition: "background 150ms",
    selectors: {
      "&:hover:not(:disabled)": {
        background: semanticColors.surfaceBorder,
      },
      "&:disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
    },
  },
  variants: {
    danger: {
      true: { color: semanticColors.textDanger },
      false: { color: semanticColors.textPrimary },
    },
  },
  defaultVariants: {
    danger: false,
  },
});
