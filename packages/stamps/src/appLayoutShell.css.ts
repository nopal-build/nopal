// packages/stamps/src/appLayoutShell.css.ts
//
// Port of `.app-layout`/`.app-topbar*`/`.app-topnav*`/`.app-main` from
// webapp's `root.css` — `AppLayout.tsx`'s structural chrome (desktop
// topbar above `breakpoints.navMin`, mobile top nav below
// `breakpoints.navMax`). `AppLayout.tsx` itself stays in
// `webapp/app/components` (it has real app logic — `useUser`,
// impersonation, route-based active state — not a generic design-system
// primitive), but its styling is fully owned here.
//
// None of these need their own dark-mode `@media` block — every color
// referenced is already a semantic token that resolves correctly per
// scheme on its own (see tokens.ts), regardless of which width-based
// `@media` query the rule itself lives under.
import { style } from "@vanilla-extract/css";
import { breakpoints, semanticColors } from "./tokens";

export const shell = style({
  display: "flex",
  flexDirection: "column",
  height: "100vh",
});

export const main = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflowX: "auto",
  overflowY: "scroll",
});

// ── Desktop topbar (≥ breakpoints.navMin) ───────────────────────────────────

export const topbar = style({
  display: "none",
  "@media": {
    [`screen and (min-width: ${breakpoints.navMin})`]: {
      display: "flex",
      alignItems: "center",
      gap: "32px",
      padding: "10px 24px",
      borderBottom: `1px solid ${semanticColors.surfaceBorder}`,
      background: semanticColors.surfaceCard,
      flexShrink: 0,
    },
  },
});

export const topbarLogo = style({
  "@media": {
    [`screen and (min-width: ${breakpoints.navMin})`]: {
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
    },
  },
});

export const topbarLogoImg = style({
  "@media": {
    [`screen and (min-width: ${breakpoints.navMin})`]: {
      height: "22px",
      width: "auto",
      display: "block",
    },
  },
});

export const topbarNav = style({
  "@media": {
    [`screen and (min-width: ${breakpoints.navMin})`]: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      margin: "0 auto",
    },
  },
});

export const topbarProfile = style({
  "@media": {
    [`screen and (min-width: ${breakpoints.navMin})`]: {
      flexShrink: 0,
    },
  },
});

// ── Mobile top nav (≤ breakpoints.navMax) ───────────────────────────────────

export const topnav = style({
  display: "none",
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      display: "block",
      background: semanticColors.surfaceCard,
      borderBottom: `1px solid ${semanticColors.surfaceBorder}`,
      position: "sticky",
      top: 0,
      zIndex: 100,
    },
  },
});

export const topnavBar = style({
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
    },
  },
});

export const topnavMenu = style({
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      borderTop: `1px solid ${semanticColors.surfaceBorder}`,
      padding: "8px 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
    },
  },
});
