// packages/stamps/src/DrawerContent.tsx
//
// The second `AppLayout` content-area type: full-width content with a
// persistent left drawer — for anything that needs its own always-visible
// nav/filter/tree alongside the content, the way the Vault folder tree
// does today (fruits/app/routes/vault.tsx's `.vault-sidebar`, which this
// generalizes — meant to be a drop-in replacement for it). See
// `CenterContent` for the other content-area type (centered, no side
// panel) — every page should pick exactly one of the two as its
// outermost content wrapper.
//
// Always visible, in normal flow, on desktop. Below `breakpoints.navMax`
// it becomes a fixed overlay that slides in/out: a backdrop click, the
// close button inside the drawer, or Escape all close it; a mobile-only
// toggle bar (hidden on desktop) drawn above `children` opens it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SidebarToggleIcon } from "./SidebarToggleIcon";
import { sprinkles } from "./sprinkles.css";
import { textSize } from "./typography.css";
import { breakpoints, semanticColors } from "./tokens";
import {
  backdrop,
  backdropVisible,
  closeRow,
  main as mainClass,
  mobileBar,
  panel,
  panelOpen,
  shell,
  toggleButton,
} from "./drawerContent.css";

/** Finds the nearest scrolling ancestor (`overflow-y: auto|scroll`) above
 * `el` -- normally `AppLayout`'s own `<main>`, but found generically
 * rather than hardcoding that tag/class, since this package doesn't know
 * about its callers' own layout. */
function findScrollingAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** The REAL fix for the desktop drawer's `max-height` (see
 * `drawerContent.css.ts`'s own comments for the two things that were
 * tried and reverted first): `100vh` overshoots by however tall whatever
 * sits above the scrolling ancestor is (a topbar, an impersonation
 * banner, ...), and a CSS-percentage alternative broke `position: sticky`
 * entirely (it requires `shell` to have an explicit, definite height,
 * which leaves `panel` no room to slide within it as the page scrolls).
 * So instead: measure the scrolling ancestor's OWN `clientHeight` at
 * runtime and apply it as an inline style, which -- being inline --
 * always wins over the CSS `100vh` fallback (pre-measurement/no-JS) AND
 * over the mobile `max-height: none` rule, so it's explicitly disabled
 * (`null`) below `breakpoints.navMax`, where the drawer is a full-height
 * fixed overlay instead and doesn't need this at all. A `ResizeObserver`
 * on the scrolling ancestor keeps it correct as the window resizes or as
 * something above it (the impersonation banner, which loads
 * asynchronously) changes size. */
function useDrawerPanelMaxHeight(panelRef: React.RefObject<HTMLElement | null>) {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;

    const scroller = findScrollingAncestor(panelEl);
    if (!scroller) return;

    const mql = window.matchMedia(`(max-width: ${breakpoints.navMax})`);

    function recompute() {
      setMaxHeight(mql.matches ? null : scroller!.clientHeight);
    }

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(scroller);
    mql.addEventListener("change", recompute);
    return () => {
      resizeObserver.disconnect();
      mql.removeEventListener("change", recompute);
    };
  }, [panelRef]);

  return maxHeight;
}

type DrawerContentProps = {
  /** Rendered inside the drawer — nav links, a folder tree, filters, … */
  drawer: ReactNode;
  children: ReactNode;
  /** Shown next to the mobile open/close toggle (e.g. `"Vault"`,
   * `"Sections"`), and used to build its accessible label ("Open
   * {title}" / "Close {title}"). Defaults to `"Menu"`. */
  title?: string;
};

export function DrawerContent({ drawer, children, title = "Menu" }: DrawerContentProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const measuredMaxHeight = useDrawerPanelMaxHeight(panelRef);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className={shell}>
      <div
        className={`${backdrop} ${open ? backdropVisible : ""}`.trim()}
        onClick={() => setOpen(false)}
      />
      <aside
        ref={panelRef}
        className={`${panel} ${open ? panelOpen : ""}`.trim()}
        style={measuredMaxHeight != null ? { maxHeight: measuredMaxHeight } : undefined}
      >
        <div className={closeRow}>
          <button
            type="button"
            className={toggleButton}
            aria-label={`Close ${title}`}
            onClick={() => setOpen(false)}
          >
            <SidebarToggleIcon open />
          </button>
        </div>
        {drawer}
      </aside>
      <div className={mainClass}>
        {!open && (
          <div className={mobileBar}>
            <button
              type="button"
              className={toggleButton}
              aria-label={`Open ${title}`}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <SidebarToggleIcon open={false} />
            </button>
            <span
              className={`${textSize.sm} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
              style={{ color: semanticColors.textBrand }}
            >
              {title}
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
