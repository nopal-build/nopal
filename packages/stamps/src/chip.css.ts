// packages/stamps/src/chip.css.ts
//
// Port of the inline `style` object `Chip.tsx` used to build by hand.
// That version had NO dark-mode handling at all — `inactive`'s colors
// were hardcoded to the day scene's `farground`/`midground`/`purple-light`
// regardless of scheme, so an inactive chip stayed cream-colored against
// a dark background. Using the semantic tokens here fixes that for free:
// `surfaceCard`/`surfaceBorder`/`textBrand` already resolve correctly per
// scheme (see root.css's dark-mode `@media` override), so this recipe
// doesn't need its own `@media` block at all.
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const chip = recipe({
  base: {
    display: "inline-block",
    userSelect: "none",
    fontFamily:
      'ui-monospace, SFMono-Regular, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
    fontSize: "0.75rem", // Tailwind's `text-xs`
    lineHeight: "1rem",
    padding: "2px 8px", // Tailwind's `px-2 py-0.5`
    borderRadius: "9999px", // Tailwind's `rounded-full`
  },
  variants: {
    active: {
      // Intentionally literal (not semantic) here: solid purple-on-cream
      // reads fine in both schemes as-is (it's the same combination
      // `--color-surface-page`'s night value already uses for the whole
      // page), unlike `inactive` below, which really did need real
      // semantic/night colors.
      true: {
        background: colors.purple,
        border: `1px solid ${colors.purple}`,
        color: semanticColors.surfaceCard,
      },
      false: {
        background: semanticColors.surfaceCard,
        border: `1px solid ${semanticColors.surfaceBorder}`,
        color: semanticColors.textBrand,
      },
    },
    interactive: {
      true: { cursor: "pointer" },
    },
  },
  defaultVariants: {
    active: false,
  },
});

export type ChipVariants = RecipeVariants<typeof chip>;
