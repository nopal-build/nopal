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
// scrolls — normally `AppLayout`'s own `main`) rather than its own
// internal scroll region. `shell` DOES now assume its rendering ancestor
// has a definite height (`min-height: 100%` — see that rule's own comment
// for why) so the drawer/content always fill the available space even
// when `children` is short, instead of shrinking to content height —
// true of `AppLayout`'s own `<main>` (`flex: 1` in a full-height column),
// the only real caller today.
//
// `panel`'s own `max-height` CANNOT be a plain CSS percentage here (see
// its own comment) without breaking that `min-height` growth -- so
// `DrawerContent.tsx` measures the real available height at runtime
// (`ResizeObserver` on the nearest scrolling ancestor) and applies it as
// an inline style, with this file's `100vh` only as the pre-measurement/
// no-JS fallback.
import { style } from "@vanilla-extract/css";
import { breakpoints, semanticColors } from "./tokens";

export const shell = style({
  display: "flex",
  // Deliberately "stretch" (the flex default), not "flex-start" -- that
  // lets `panel` (below) stretch to the row's full height (i.e. as tall
  // as `main`'s content) before its own `maxHeight: 100%` clamps it back
  // down to exactly this row's own height. Without the stretch, `panel`
  // would only ever be as tall as its own (short) nav content, so its
  // background wouldn't reach the bottom of a taller screen and `sticky`
  // would have no room to hold it in place while `main` scrolls.
  alignItems: "stretch",
  // `alignItems: stretch` only stretches `panel`/`main` to match EACH
  // OTHER's height -- it does nothing when BOTH are shorter than the
  // available space (e.g. a content view showing just one short item),
  // since the row itself still only grows as tall as its tallest child's
  // own natural content height. `min-height: 100%` gives the row a FLOOR
  // equal to its actual rendering ancestor's height instead (normally
  // `AppLayout`'s own `<main>`, which already has a definite computed
  // height via `flex: 1` in a full-height column -- see
  // `appLayoutShell.css.ts` -- so this resolves correctly, it doesn't fall
  // back to `auto`/0 the way a percentage height against an indefinite
  // ancestor would). Deliberately `min-height`, not `height`: a `height`
  // would CAP this row at exactly one screen tall, leaving `panel` zero
  // room to slide within it as `main` scrolls -- `position: sticky` only
  // has a visible "stuck" range for as long as ITS OWN containing block
  // (this row) is taller than the sticky element itself, so capping this
  // row's height to match `panel`'s own height breaks stickiness
  // entirely (confirmed: it made `panel` scroll away immediately instead
  // of staying pinned -- a real regression hit and reverted while
  // building this). `min-height` only ever raises the floor, so taller
  // content keeps growing the row naturally, preserving `panel`'s full
  // stuck range, and still relies on `<main>`'s one existing scrollbar.
  minHeight: "100%",
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
  // `100vh` is only a FALLBACK, overridden by `DrawerContent.tsx` via an
  // inline `maxHeight` style once it measures the real number (a
  // `ResizeObserver` on the nearest scrolling ancestor's `clientHeight`).
  // `panel` doesn't start at the window's own top edge -- it starts
  // wherever that scrolling ancestor's own visible viewport starts
  // (below `AppLayout`'s topbar, and its impersonation banner when
  // shown) -- so `100vh` alone overshoots the real available height by
  // exactly that much, pushing the drawer's own bottom edge that far past
  // the bottom of the actual browser window, permanently: a `position:
  // sticky` box's own height doesn't change as you scroll, so that
  // overshoot is never reachable no matter how far anything is scrolled.
  // (A CSS-only `max-height: 100%` fix was tried and reverted -- see
  // `shell`'s own comment for why that broke sticky positioning entirely
  // instead.)
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
