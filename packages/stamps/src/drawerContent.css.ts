// packages/stamps/src/drawerContent.css.ts
//
// Backs the `DrawerContent` component — the second `AppLayout`
// content-area type (see `centerContent.css.ts` for the other). A port
// of the Vault folder tree's `.vault-sidebar`/`.vault-sidebar-backdrop`/
// `.vault-sidebar-toggle` (fruits/app/styles/vault.css) generalized into
// a reusable primitive: always-visible, sticky-positioned drawer on
// desktop; a fixed slide-in overlay with its own backdrop below
// `breakpoints.navMax`, same as Vault's.
//
// Desktop uses `position: sticky` (tracking whatever ancestor actually
// scrolls — normally `AppLayout`'s own `main`) rather than `height: 100%`
// + its own internal scroll region, so this doesn't need to assume
// anything about the height of whatever renders it.
import { style } from "@vanilla-extract/css";
import { breakpoints, semanticColors } from "./tokens";

export const shell = style({
  display: "flex",
  // Deliberately "stretch" (the flex default), not "flex-start" — that
  // lets `panel` (below) stretch to the row's full height (i.e. as tall
  // as `main`'s content) before its own `maxHeight: 100vh` clamps it back
  // down to exactly one viewport. Without the stretch, `panel` would only
  // ever be as tall as its own (short) nav content, so its background
  // wouldn't reach the bottom of a taller screen and `sticky` would have
  // no room to hold it in place while `main` scrolls.
  alignItems: "stretch",
});

export const panel = style({
  width: "240px",
  flexShrink: 0,
  borderRight: `1px solid ${semanticColors.surfaceBorder}`,
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  background: semanticColors.surfaceCard,
  position: "sticky",
  top: 0,
  maxHeight: "100vh",
  overflowY: "auto",
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      position: "fixed",
      top: 0,
      left: 0,
      bottom: 0,
      maxHeight: "none",
      zIndex: 200,
      width: "280px",
      transform: "translateX(-100%)",
      transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
    },
  },
});

export const panelOpen = style({
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      transform: "translateX(0)",
    },
  },
});

export const backdrop = style({
  display: "none",
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.4)",
      zIndex: 150,
    },
  },
});

export const backdropVisible = style({
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      display: "block",
    },
  },
});

// Close button row — top of the drawer, mobile only (desktop's drawer is
// always open, nothing to close).
export const closeRow = style({
  display: "none",
  justifyContent: "flex-end",
  paddingBottom: "8px",
  flexShrink: 0,
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      display: "flex",
    },
  },
});

export const main = style({
  flex: 1,
  minWidth: 0,
});

// Shared by both the drawer's own close button and `main`'s open
// button — a port of Vault's `.vault-sidebar-toggle` (bordered square,
// not the round `CircleButton`) so `DrawerContent` looks identical to
// the layout it's meant to be a drop-in replacement for.
export const toggleButton = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background: "none",
  border: `1px solid ${semanticColors.surfaceBorder}`,
  borderRadius: "6px",
  padding: "5px 9px",
  lineHeight: 1,
  cursor: "pointer",
  color: semanticColors.textBrand,
});

// Open-drawer toggle bar, rendered above `children` — mobile only
// (desktop's drawer is always visible, no toggle needed).
export const mobileBar = style({
  display: "none",
  alignItems: "center",
  gap: "8px",
  padding: "10px 16px",
  borderBottom: `1px solid ${semanticColors.surfaceBorder}`,
  "@media": {
    [`screen and (max-width: ${breakpoints.navMax})`]: {
      display: "flex",
    },
  },
});
