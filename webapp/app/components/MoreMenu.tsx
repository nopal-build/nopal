// app/components/MoreMenu.tsx
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleButton } from "./CircleButton";

/**
 * The "•••" trigger icon on its own, in case a caller needs the glyph
 * without the menu behavior (e.g. inside a differently-composed button).
 * Bigger, bolder dots than a typed ellipsis or a typical 24px icon-font
 * glyph — this is the whole point of drawing it as an SVG instead of
 * reaching for the `…` character.
 */
export function MoreIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="3" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="12" r="3" />
    </svg>
  );
}

export type MoreMenuItem = {
  label: string;
  onClick: () => void;
  /** Styles the item's text red — use for destructive actions (Delete, Revoke, etc). */
  danger?: boolean;
  disabled?: boolean;
};

type MoreMenuTriggerProps = {
  open: boolean;
  /** Toggles the menu open/closed — wire this to your trigger's `onClick`. */
  toggle: () => void;
  /** Accessible name passed through from `MoreMenu`'s `label` prop. */
  label: string;
};

type MoreMenuPanelProps = {
  /** Closes the panel — wire this to a custom action's completion (plain
   * `items` already auto-close on click; custom `children` content is
   * responsible for calling this itself). */
  close: () => void;
};

type MoreMenuProps = {
  /** A plain action list. Ignored (and optional) when `children` is given. */
  items?: MoreMenuItem[];
  /**
   * Custom panel content instead of a plain action list — e.g. a small
   * inline form (see the vault's "New folder" panel). Mutually exclusive
   * with `items`; the menu still owns open/close state, positioning,
   * outside-click, and Escape either way.
   */
  children?: (props: MoreMenuPanelProps) => ReactNode;
  /** Accessible name for the default trigger button. Defaults to "More actions". Ignored if you pass your own `trigger`. */
  label?: string;
  /** Which side of the trigger the panel hangs off of. Defaults to "right". */
  align?: "left" | "right";
  /** Applied to the outer wrapper — e.g. to override the default `inline-block`. */
  className?: string;
  /**
   * Render your own trigger instead of the default `CircleButton` +
   * "•••" — e.g. a `btn-primary` or `btn-outline` button. The menu still
   * owns open/close state, outside-click, and Escape handling either way;
   * you're only responsible for wiring `onClick={toggle}` (and ideally
   * `aria-haspopup="menu"` / `aria-expanded={open}`) on whatever you render.
   */
  trigger?: (props: MoreMenuTriggerProps) => ReactNode;
};

// Gap between the trigger and the panel, and the minimum breathing room
// kept between the panel and the edge of the viewport.
const TRIGGER_GAP = 6;
const VIEWPORT_MARGIN = 8;

type MenuPosition = { top: number; left: number };

/**
 * A small `good-box` action menu, opened by a trigger of your choosing.
 * Closes on Escape, on an outside click, or after an item is clicked. Use
 * this instead of hand-rolling a per-row "..." menu (see `RelationshipCard`
 * in `fruits_.profile.tsx` for the pattern this replaces) — it bundles the
 * open-state, click-outside, and Escape handling so call sites only need
 * to supply `items`.
 *
 * Defaults to a `CircleButton` with an oversized "•••" (`MoreIcon`) as the
 * trigger, which covers the common case. Pass `trigger` to use a
 * differently-styled button instead (see the "custom trigger" example in
 * `fruits_.styles.tsx`).
 *
 * The panel is positioned with a flip/shift strategy rather than plain
 * CSS: it measures the trigger and panel with `getBoundingClientRect`,
 * prefers opening below-and-off the requested `align` edge, but flips
 * above/to-the-other-edge (and finally clamps to the viewport) whenever
 * the preferred spot would overflow. It's rendered with `position: fixed`
 * so a trigger that's wrapped to an unexpected spot (e.g. a toolbar that
 * wraps on mobile) never drags the panel half off-screen with it.
 */
export function MoreMenu({
  items = [],
  children,
  label = "More actions",
  align = "right",
  className = "",
  trigger,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggle = () => setOpen((o) => !o);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Recompute the panel's position whenever it opens (and keep it glued
  // to the trigger on resize/scroll while it's open). Runs in a layout
  // effect so the panel never flashes at its old/default spot.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function reposition() {
      const triggerEl = triggerRef.current;
      const panelEl = panelRef.current;
      if (!triggerEl || !panelEl) return;

      const triggerRect = triggerEl.getBoundingClientRect();
      const panelRect = panelEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Vertical: prefer opening below the trigger; flip above it only if
      // there isn't room below but there's more room above.
      const spaceBelow = vh - triggerRect.bottom - TRIGGER_GAP;
      const spaceAbove = triggerRect.top - TRIGGER_GAP;
      const openUpward = panelRect.height > spaceBelow && spaceAbove > spaceBelow;
      const top = openUpward
        ? triggerRect.top - TRIGGER_GAP - panelRect.height
        : triggerRect.bottom + TRIGGER_GAP;

      // Horizontal: try the requested edge first, flip to the other edge
      // if that overflows, then clamp to the viewport as a last resort.
      let left =
        align === "right"
          ? triggerRect.right - panelRect.width
          : triggerRect.left;
      const overflowsRight = left + panelRect.width > vw - VIEWPORT_MARGIN;
      const overflowsLeft = left < VIEWPORT_MARGIN;
      if (align === "right" && overflowsLeft) {
        left = triggerRect.left;
      } else if (align === "left" && overflowsRight) {
        left = triggerRect.right - panelRect.width;
      }
      left = Math.min(
        Math.max(left, VIEWPORT_MARGIN),
        vw - panelRect.width - VIEWPORT_MARGIN,
      );

      setPosition({ top, left });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align]);

  return (
    <div
      ref={rootRef}
      className={`relative inline-block ${className}`.trim()}
    >
      <div ref={triggerRef} className="inline-block">
        {trigger ? (
          trigger({ open, toggle, label })
        ) : (
          <CircleButton
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            active={open}
            onClick={toggle}
          >
            <MoreIcon />
          </CircleButton>
        )}
      </div>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="good-box flex flex-col gap-0.5"
          style={{
            position: "fixed",
            top: position ? position.top : -9999,
            left: position ? position.left : -9999,
            visibility: position ? "visible" : "hidden",
            minWidth: "170px",
            zIndex: 20,
            padding: "4px",
          }}
        >
          {children
            ? children({ close: () => setOpen(false) })
            : items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={[
                    "menu-item text-sm",
                    item.danger ? "red-text" : "purple-text",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
