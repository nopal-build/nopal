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
import { useEffect, useState, type ReactNode } from "react";
import { SidebarToggleIcon } from "./SidebarToggleIcon";
import { sprinkles } from "./sprinkles.css";
import { textSize } from "./typography.css";
import { semanticColors } from "./tokens";
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
      <aside className={`${panel} ${open ? panelOpen : ""}`.trim()}>
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
