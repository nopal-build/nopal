// packages/stamps/src/ActionBar.tsx
//
// A small toolbar of icon buttons -- built for the split markdown/preview
// editor's own "flip layout" + "expand" controls, but generic (nothing
// here is Vault/website-specific). `ActionBar` is the outer row (gap
// between GROUPS); `ActionBarGroup` joins 1+ buttons into a single
// shared-border pill (see `actionBar.css.ts`'s own header for why even a
// standalone button is a one-button group, not a special case); a plain
// `<button>` gets each one's real click behavior/`aria-label` --
// `ActionBarButton` only supplies the shared visual treatment.
import type { ReactNode } from "react";
import { bar, button, group } from "./actionBar.css";

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className={bar}>{children}</div>;
}

export function ActionBarGroup({ children }: { children: ReactNode }) {
  return <div className={group}>{children}</div>;
}

export function ActionBarButton({
  onClick,
  active,
  disabled,
  "aria-label": ariaLabel,
  children,
}: {
  onClick: () => void;
  /** Highlights this button as the currently-selected one in its group
   * (e.g. a mobile Preview/Markdown toggle rendered as an `ActionBarGroup`
   * of two `ActionBarButton`s) -- omit for a plain momentary action
   * (Expand, Flip Layout). */
  active?: boolean;
  disabled?: boolean;
  "aria-label": string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={button({ active })}
    >
      {children}
    </button>
  );
}
