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
import { useStickyPaneMaxHeight } from "./useStickyPaneMaxHeight";
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

/** True below `breakpoints.navMax`, where the drawer becomes a full-height
 * fixed overlay instead of a sticky sidebar and doesn't need the
 * measured-max-height fix at all (see the `useStickyPaneMaxHeight` call
 * below) -- reactive to the window crossing that breakpoint, not just a
 * one-time check at mount. */
function useIsMobileDrawer(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.navMax})`);
    const recompute = () => setIsMobile(mql.matches);
    recompute();
    mql.addEventListener("change", recompute);
    return () => mql.removeEventListener("change", recompute);
  }, []);
  return isMobile;
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
  // See `useStickyPaneMaxHeight`'s own header for the full "why" -- this
  // is the fix for `panel`'s CSS `max-height: 100vh` (drawerContent.css.ts)
  // overshooting the real available height. Disabled on mobile, where the
  // drawer is a full-height fixed overlay (`max-height: none`) that
  // doesn't need it.
  const isMobile = useIsMobileDrawer();
  const measuredMaxHeight = useStickyPaneMaxHeight(panelRef, isMobile);

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
