// packages/stamps/src/useStickyPaneMaxHeight.ts
//
// Shared logic behind `DrawerContent`'s own sticky sidebar fix -- see that
// file's `drawerContent.css.ts` for the full story of the bug this
// avoids: `max-height: 100vh` on a `position: sticky` element overshoots
// the REAL available height by however tall whatever sits above the
// nearest scrolling ancestor is (a topbar, a banner, ...), permanently
// hiding that many pixels off the bottom, unreachable by any amount of
// scrolling, because a sticky element's own height never changes as you
// scroll. The only reliable fix: measure the real scrolling ancestor's
// own `clientHeight` at runtime and use THAT as the cap, kept correct via
// `ResizeObserver` as the window resizes or as something above it
// changes size.
//
// Extracted here (rather than staying private to `DrawerContent.tsx`) so
// any other sticky-pane-with-a-pinned-bottom-affordance feature (e.g.
// Vault's website-page split editor's own sticky Markdown pane, whose
// Save button needs to stay visible the same way) can reuse the exact
// same fix instead of re-discovering/re-debugging it.
//
// ALSO accounts for the pane's own natural (pre-stuck) offset within the
// scroller -- a SECOND real bug found testing this against Vault's split
// editor: unlike `DrawerContent`'s `panel` (the first thing in its own
// scrolling container), that pane sits BELOW a breadcrumb + toolbar row
// within the SAME scroller, so before the user scrolls far enough to
// engage the sticky clamp, the pane renders at its full (uncapped-by-
// that-offset) height starting partway down the screen -- pushing its
// own Save button off the BOTTOM of the viewport on first load, only
// reappearing once scrolled enough to stick. Subtracting that natural
// offset makes the pane correctly sized to fit within the viewport EVEN
// BEFORE it engages sticky -- a no-op for `DrawerContent` (offset 0,
// nothing precedes its own panel).
import { useEffect, useState, type RefObject } from "react";

/** Finds the nearest scrolling ancestor (`overflow-y: auto|scroll`) above
 * `el`, walking up `parentElement` generically rather than assuming any
 * particular caller's own DOM shape (normally `AppLayout`'s `<main>`, but
 * this file doesn't know or care). */
function findScrollingAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** Returns the real available height (in px) for a sticky-positioned
 * element referenced by `paneRef` -- `null` until measured (the CSS
 * fallback, e.g. a plain `100vh`, should apply in the meantime) or
 * whenever `disabled` is true (e.g. a caller that only wants this
 * measurement above some responsive breakpoint, below which the element
 * isn't sticky at all). */
export function useStickyPaneMaxHeight(
  paneRef: RefObject<HTMLElement | null>,
  disabled?: boolean,
): number | null {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setMaxHeight(null);
      return;
    }
    const paneEl = paneRef.current;
    if (!paneEl) return;

    const scroller = findScrollingAncestor(paneEl);
    if (!scroller) return;

    function recompute() {
      // `clientHeight` alone overshoots whenever the scroller has its own
      // vertical padding (found the hard way testing this against Vault's
      // `.vault-main`, which does -- `DrawerContent`'s own scroller,
      // AppLayout's `<main>`, happens to have none, so this never showed
      // up there). Per spec, a sticky element's constraint rectangle is
      // the scroller's PADDING BOX, not a bare `clientHeight` reading --
      // subtracting the scroller's own top+bottom padding gives the real
      // available height for a sticky child inset by that same padding.
      const style = getComputedStyle(scroller!);
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const paddingBottom = parseFloat(style.paddingBottom) || 0;
      const available = scroller!.clientHeight - paddingTop - paddingBottom;

      // How far below the scroller's own content-top this pane naturally
      // starts, pre-stick (see this file's own header for why -- valid as
      // measured here since `recompute` only ever runs on mount/resize,
      // never on plain scroll, so it isn't reading a stuck/clamped
      // position by the time this runs in the common case).
      const paneRect = paneEl!.getBoundingClientRect();
      const scrollerRect = scroller!.getBoundingClientRect();
      const naturalOffset = paneRect.top - scrollerRect.top + scroller!.scrollTop;

      const raw = available - naturalOffset;
      // A REAL BUG, found via a real repro, not just reasoning about the
      // math: a non-positive `raw` here has always meant "this particular
      // measurement is garbage" in every case actually seen -- `available`
      // reading near-zero because the scroller's own ancestors hadn't
      // resolved a definite height yet at that exact moment (a `height:
      // 100%`-up-the-chain layout, like `appLayoutShell.css.ts`'s, only
      // resolves once EVERY ancestor up to `<html>` has one -- timing-
      // sensitive around hydration/first paint), OR `naturalOffset` coming
      // out anomalously large for some other transient reason -- NEVER a
      // legitimate "this sticky sidebar genuinely has zero room." The old
      // code trusted it anyway (`Math.max(0, raw)`), silently clamping to
      // a bogus `0` that collapsed `panel` to nothing -- and nothing ever
      // recovered it afterward unless the scroller's size happened to
      // change again later (a real window resize), since nothing else ever
      // re-runs this. Skipping the update instead -- leaving whatever
      // value (or `null`, falling back to this file's own CSS `100vh`)
      // already applied -- means a bad reading is simply ignored rather
      // than committed; `ResizeObserver` keeps firing on every subsequent
      // real size change regardless, so a good measurement still lands the
      // moment one's actually available, with no retry/poll needed here.
      if (raw <= 0) return;

      setMaxHeight(raw);
    }

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(scroller);
    return () => resizeObserver.disconnect();
  }, [paneRef, disabled]);

  return maxHeight;
}
