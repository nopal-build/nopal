// app/components/CircleButton.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type CircleButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  /** Shows the hover/pressed background + purple text \u2014 e.g. while a menu it triggers is open. */
  active?: boolean;
  /** Diameter in px. Defaults to 36. */
  size?: number;
};

/**
 * A round icon-only button — transparent by default, with a tinted
 * background + purple text on hover/focus/`active`. It only owns the
 * circular hit area and interactive states, not the icon itself, so any
 * SVG (or other glyph) works as `children` — see `MoreIcon` in
 * `MoreMenu.tsx` for the "•••" example, or use your own.
 *
 * This is intentionally just a button, not a menu — pair it with your own
 * `onClick`/open-state for a dropdown trigger (see `MoreMenu`'s `trigger`
 * prop), a standalone icon action, etc. Don't reach for `<Chip>`/`<Badge>`
 * or a plain `<button>` for a round icon-only control; use this instead so
 * hover/focus states stay consistent (and dark-mode-safe) everywhere.
 */
export function CircleButton({
  children,
  active = false,
  size = 36,
  className = "",
  style,
  type = "button",
  ...rest
}: CircleButtonProps) {
  return (
    <button
      type={type}
      data-active={active ? "true" : undefined}
      className={`circle-btn ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
