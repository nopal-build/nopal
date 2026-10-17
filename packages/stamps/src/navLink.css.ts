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
import { colors, darkModeMediaQuery, semanticColors } from "./tokens";

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
      // A `DrawerContent` nav list item (see the Stamps guide's own
      // category nav) — same idea as `mobile`, just tighter vertical
      // padding since a drawer stacks many more links in less height.
      drawer: {
        display: "block",
        padding: "3px 8px",
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
    // An opt-in, more vibrant BRAND accent for the active highlight —
    // used by the public marketing site's own nav (`WebsiteHeader`/
    // `WebsiteLink` pass `tone: "website"`), which wants its current-page
    // state to read as a distinct brand color rather than the app's own
    // quieter neutral `navActiveBg` (AppLayout's Daily Log/Vault/Maker,
    // DrawerContent's folder tree, ... all keep that default — this is a
    // SEPARATE variant axis, not a new `context`, specifically so it only
    // takes effect where a caller explicitly asks for it). A no-op by
    // itself (empty style) — see the `compoundVariants` entry below for
    // where it actually takes effect, paired with `active: true`.
    tone: {
      website: {},
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
    {
      variants: { active: true, tone: "website" },
      style: {
        background: semanticColors.navActiveAccentBg,
        color: colors.purple,
        "@media": {
          // `navActiveAccentBg` itself swaps to a deeper rung in dark
          // mode (root.css) since the paler one is already what ordinary
          // nav link TEXT renders in under dark mode — so text needs its
          // OWN swap to white here too, unlike the plain `active` block
          // above (whose background stays light/white in both schemes).
          [darkModeMediaQuery]: { color: "white" },
        },
      },
    },
  ],
  defaultVariants: {
    context: "topbar",
    active: false,
  },
});

export type NavLinkVariants = RecipeVariants<typeof navLink>;
