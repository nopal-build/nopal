// app/components/MoreMenu.tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
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

type MoreMenuProps = {
  items: MoreMenuItem[];
  /** Accessible name for the default trigger button. Defaults to "More actions". Ignored if you pass your own `trigger`. */
  label?: string;
  /** Which side of the trigger the panel hangs off of. Defaults to "right". */
  align?: "left" | "right";
  /** Applied to the outer wrapper — e.g. to override the default `inline-block`. */
  className?: string;
  /**
   * Applied to the default `CircleButton` trigger — e.g. `circle-btn-on-light`
   * when the menu sits on a surface that stays light in both color schemes
   * (see `RelationshipCard` in `fruits_.profile.tsx`). Ignored if you pass
   * your own `trigger`.
   */
  triggerClassName?: string;
  /**
   * Render your own trigger instead of the default `CircleButton` +
   * "•••" — e.g. a `btn-primary` or `btn-outline` button. The menu still
   * owns open/close state, outside-click, and Escape handling either way;
   * you're only responsible for wiring `onClick={toggle}` (and ideally
   * `aria-haspopup="menu"` / `aria-expanded={open}`) on whatever you render.
   */
  trigger?: (props: MoreMenuTriggerProps) => ReactNode;
};

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
 */
export function MoreMenu({
  items,
  label = "More actions",
  align = "right",
  className = "",
  triggerClassName,
  trigger,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={rootRef}
      className={`relative inline-block ${className}`.trim()}
    >
      {trigger ? (
        trigger({ open, toggle, label })
      ) : (
        <CircleButton
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          active={open}
          className={triggerClassName}
          onClick={toggle}
        >
          <MoreIcon />
        </CircleButton>
      )}

      {open && (
        <div
          role="menu"
          className="good-box flex flex-col gap-0.5"
          style={{
            position: "absolute",
            [align]: 0,
            top: "calc(100% + 6px)",
            minWidth: "170px",
            zIndex: 20,
            padding: "4px",
          }}
        >
          {items.map((item) => (
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
