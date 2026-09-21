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
      // Intentionally literal `colors.purple` + `colors.white` (not
      // semantic tokens) here — same pairing `button.css`'s `primary`
      // variant uses, and it reads fine in both schemes as-is (dark mode
      // just inverts the whole page to this exact combination already).
      // `semanticColors.surfaceCard` would be wrong here despite the
      // name looking plausible: it flips to a muted dark purple-blue at
      // night, not white, which would’ve left this low-contrast against
      // the equally-purple background.
      true: {
        background: colors.purple,
        border: `1px solid ${colors.purple}`,
        color: colors.white,
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
  compoundVariants: [
    // A read-only tag and an interactive-but-unselected chip used to be
    // pixel-identical — `cursor` was the only difference, which is
    // invisible until you hover (and doesn't exist at all on touch).
    // Dropping the fill here gives interactive chips their own "this is
    // choosable" look at rest: outline while unselected, solid once
    // `active` (which already looks different and is unaffected, since
    // this only matches `active: false`). A plain read-only `<Chip>`
    // (no `onClick`) is untouched — it keeps the filled look.
    {
      variants: { active: false, interactive: true },
      style: { background: "transparent" },
    },
  ],
  defaultVariants: {
    active: false,
  },
});

export type ChipVariants = RecipeVariants<typeof chip>;
