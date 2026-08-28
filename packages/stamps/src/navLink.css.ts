// packages/stamps/src/navLink.css.ts
//
// Port of `AppLayout.tsx`'s `navLinkClass`/`navLinkStyle`/`topbarLinkClass`/
// `topbarLinkStyle` — four separate functions collapsed into one recipe
// with two variant axes (`context` for topbar-vs-mobile layout,
// `active` for the current-page highlight). Font size/family are
// deliberately NOT part of this recipe — apply `stamps/typography.css`'s
// `textSize.sm` and `sprinkles({ fontFamily: "mono" })` alongside it,
// same separation of concerns as everywhere else (a recipe owns
// interactive/variant state, not universal utility values).
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { colors, semanticColors } from "./tokens";

export const navLink = recipe({
  base: {
    textDecoration: "none",
    borderRadius: "4px", // matches `.menu-item`'s radius
    transition: "background 150ms, color 150ms",
    color: semanticColors.textBrand,
  },
  variants: {
    context: {
      topbar: {
        padding: "6px 14px",
      },
      mobile: {
        display: "block",
        paddingTop: "8px",
        paddingBottom: "8px",
      },
    },
    active: {
      true: {
        fontWeight: 700,
        // Intentionally literal (not semantic) — the highlight background
        // is already dark (day) or solid white (night) — see
        // `navActiveBg` in tokens.ts — so dark purple text stays readable
        // against it in BOTH schemes, unlike ordinary body text (which
        // flips to white at night).
        color: colors.purple,
        background: semanticColors.navActiveBg,
      },
      false: {},
    },
  },
  compoundVariants: [
    // The mobile menu's active item gets a little extra left indent on
    // top of the highlight — a small nudge so the text doesn't sit flush
    // against the highlight's edge. Topbar links don't need this (their
    // horizontal padding is already symmetric and generous).
    {
      variants: { context: "mobile", active: true },
      style: { paddingLeft: "8px" },
    },
  ],
  defaultVariants: {
    context: "topbar",
    active: false,
  },
});

export type NavLinkVariants = RecipeVariants<typeof navLink>;
