// packages/stamps/src/badge.css.ts
//
// Port of `.badge-*` from webapp's `root.css`, plus the Tailwind utility
// classes `Badge.tsx` used to layer on top of them (`text-xs px-2 py-0.5
// rounded-full font-mono shrink-0`) — folded into `base` here so consumers
// need zero Tailwind classes at all. Referencing `recipe(...)`'s output
// (`badge({ variant })`) is the replacement for stringing utility classes
// together by hand.
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, darkModeMediaQuery, fonts } from "./tokens";

export const badge = recipe({
  base: {
    display: "inline-block",
    flexShrink: 0,
    fontFamily: fonts.mono,
    fontSize: "0.75rem", // Tailwind's `text-xs`
    lineHeight: "1rem",
    padding: "2px 8px", // Tailwind's `px-2 py-0.5`
    borderRadius: "9999px", // Tailwind's `rounded-full`
  },
  variants: {
    variant: {
      // Built from light-scheme surface tokens, so it needs an explicit
      // dark-mode pair or it vanishes against a dark card (see the
      // `stamps` component guide once it exists for more on this
      // convention).
      neutral: {
        background: colors.farground,
        border: `1px solid ${colors.midground}`,
        color: colors.purpleLight,
        "@media": {
          [darkModeMediaQuery]: {
            background: colors.darkMidground,
            borderColor: colors.darkForeground,
            color: "white",
          },
        },
      },
      success: {
        background: colors.greenLight,
        color: colors.purple,
      },
      warning: {
        background: colors.yellow,
        color: colors.purple,
      },
      danger: {
        background: colors.redLight,
        color: colors.red,
      },
      accent: {
        background: colors.moon,
        color: colors.purple,
      },
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

export type BadgeVariants = RecipeVariants<typeof badge>;
