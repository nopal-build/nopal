// packages/stamps/src/surface.css.ts
//
// The `Surface` primitive is `stamps`'s replacement for webapp's
// `.good-box`/`.good-box-hover` global CSS classes — the de-facto
// universal card/panel primitive already used everywhere (Modal,
// MoreMenu, SearchCollection, project rows, …) despite its
// marketing-flavored name. NOT deleting `.good-box`/`.good-box-hover`
// from root.css yet — plenty of consumers (marketing's `GoodAssets`,
// `MoreMenu`, `SearchCollection`, …) haven't migrated to `stamps` yet and
// still reference those classes directly. Point more consumers at this
// over time, then retire the old classes once nothing references them.
//
// Plain `style()`/`globalStyle()` rather than `recipe()` here — there's
// only one boolean variant (`hoverable`), and `globalStyle` (needed for
// the descendant `hr` selector below) isn't compatible with vanilla-
// extract's `selectors` API used inside a recipe's variants (that API
// only allows targeting `&` + modifiers, not descendant elements — see
// https://vanilla-extract.style/documentation/global-api/global-style/).
import { globalStyle, style } from "@vanilla-extract/css";
import { colors, darkModeMediaQuery, semanticColors } from "./tokens";

export const surfaceBase = style({
  border: `1px solid ${semanticColors.surfaceBorder}`,
  background: semanticColors.surfaceCard,
  borderRadius: 8,
});

globalStyle(`${surfaceBase} hr`, {
  borderColor: semanticColors.surfaceBorder,
});

// Port of `.good-box-boarder` — border only, no background. Good for
// nested sections inside another Surface.
export const surfaceBorderOnly = style({
  border: `1px solid ${semanticColors.surfaceBorder}`,
  borderRadius: 8,
});

// Port of `.good-box-hover:hover` minus the `.good-arrow svg path` bit,
// which is specific to marketing's `GoodAssets` links, not a generic
// surface concern.
export const surfaceHoverable = style({
  selectors: {
    "&:hover": {
      cursor: "pointer",
      borderColor: colors.purpleLight,
      boxShadow: "0px 0px 8px rgba(0, 0, 0, 0.05)",
    },
  },
  "@media": {
    [darkModeMediaQuery]: {
      selectors: {
        "&:hover": {
          borderColor: colors.pink,
        },
      },
    },
  },
});
