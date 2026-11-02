// packages/stamps/src/stepper.css.ts
//
// First used by the project-map onboarding funnel prototype
// (fruits/app/routes/prototype.*.tsx) to replace a one-off
// `FunnelSteps` component that hand-rolled this exact look. Generic
// enough for any multi-page wizard, not specific to that funnel.
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { style } from "@vanilla-extract/css";
import { semanticColors } from "./tokens";

export const list = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "12px 18px",
  fontSize: "0.78rem",
});

export const item = recipe({
  base: {
    position: "relative",
    paddingBottom: "4px",
    color: semanticColors.textSubtle,
  },
  variants: {
    state: {
      upcoming: {},
      done: { color: semanticColors.textPrimary },
      current: {
        color: semanticColors.textBrand,
        fontWeight: 700,
        selectors: {
          "&::after": {
            content: "",
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "2px",
            background: semanticColors.textBrand,
          },
        },
      },
    },
  },
  defaultVariants: {
    state: "upcoming",
  },
});

export type ItemVariants = RecipeVariants<typeof item>;
