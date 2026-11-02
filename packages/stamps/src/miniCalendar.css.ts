// packages/stamps/src/miniCalendar.css.ts
//
// First used by the project-map onboarding funnel prototype's
// scheduling step (fruits/app/routes/prototype.schedule.tsx) as a
// compact secondary way to jump to a date, alongside a planner-style
// list of open times. Deliberately small — this is a sidebar widget,
// not a full-page calendar.
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { style } from "@vanilla-extract/css";
import { colors, semanticColors } from "./tokens";

export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "8px",
});

export const grid = style({
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: "2px",
});

export const weekday = style({
  textAlign: "center",
  fontSize: "0.6rem",
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: semanticColors.textSubtle,
  paddingBottom: "2px",
});

export const cell = recipe({
  base: {
    aspectRatio: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    border: "1px solid transparent",
    background: "none",
    fontSize: "0.72rem",
    padding: 0,
    color: semanticColors.textSubtle,
    opacity: 0.4,
    cursor: "default",
  },
  variants: {
    available: {
      true: {
        opacity: 1,
        color: semanticColors.textPrimary,
        borderColor: semanticColors.surfaceBorder,
        cursor: "pointer",
        selectors: {
          "&:hover": { borderColor: semanticColors.textBrand, color: semanticColors.textBrand },
        },
      },
    },
    selected: {
      true: {
        background: colors.purple,
        borderColor: colors.purple,
        color: colors.white,
      },
    },
  },
  defaultVariants: {
    available: false,
    selected: false,
  },
});

export type CellVariants = RecipeVariants<typeof cell>;
