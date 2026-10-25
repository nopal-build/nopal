// packages/stamps/src/Checkbox.tsx
import { box, dot, labelText, srOnlyInput, wrapper } from "./checkbox.css";

/** The `"checkbox"` variant's checked glyph -- an X, not a tick, matching
 * OxMarkdown's own task-checkbox exactly (`.ox-task-checkbox.checked::
 * after`'s inline SVG, `styles/oxmarkdown.css`: two diagonals of a
 * square). `currentColor`-based (see `ExpandIcon`'s own comment for this
 * convention) rather than OxMarkdown's own hardcoded `#7f5b8b` -- so it
 * always matches `box`'s own accent-colored border with one less literal
 * value to keep in sync, and (unlike the hardcoded hex) actually follows
 * dark mode's own accent swap. */
function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

type CheckboxProps = {
  checked: boolean;
  /** Required when `label` is given (a real, standalone field) -- omit
   * `label` entirely for the presentational-only mode below. */
  onChange?: (checked: boolean) => void;
  /** Renders a complete, accessible field: a real (visually hidden)
   * `<input type="checkbox"|"radio">` wrapped in a `<label>`, so clicking
   * the label or the box itself toggles it and it participates in a real
   * `<form>`/screen readers correctly. Omit this entirely to get back
   * just the plain visual box (a `<span aria-hidden>`, no input, no
   * click handling of its own) -- for composing INSIDE an ancestor that
   * already owns the interactive/ARIA role (e.g. a `role="radio"`
   * selectable card, which is what the website `::box` directive uses
   * this for: a single click/Enter on the CARD selects it, and this
   * component only needs to reflect that state visually, never handle
   * its own click). */
  label?: string;
  name?: string;
  disabled?: boolean;
  /** Visually hides the label while keeping it in the DOM for screen
   * readers -- same convention as `Input`'s own `hideLabel`. Only
   * meaningful when `label` is given. */
  hideLabel?: boolean;
  className?: string;
  /** `"checkbox"` (default) -- OxMarkdown's own task-checkbox look: a
   * 5px-radius square, border always accent-colored, background always
   * transparent -- checked shows an X overlay, nothing more. `"radio"`
   * -- the same look on a circle, with a smaller filled dot overlay
   * instead of the X, for a MUTUALLY EXCLUSIVE selection (the same
   * visual convention a native `<input type="radio">` already uses) --
   * e.g. the website `::box` directive's own select-group pricing
   * cards, where picking one deselects every other box sharing the same
   * group. Also picks the native input's own `type` in standalone
   * (`label`-given) mode. */
  variant?: "checkbox" | "radio";
};

/**
 * A checkbox (or radio, via `variant="radio"`) visually matched to
 * OxMarkdown's own task-list checkbox (see `checkbox.css.ts`'s own
 * header comment) -- not a second, independent "checkbox" look
 * elsewhere in the app. Two modes:
 *
 * - **Standalone field** (`label` given): a real `<input
 *   type="checkbox"|"radio">`, visually hidden, wrapped in a `<label>`
 *   -- use this for an ordinary settings/form field.
 * - **Presentational** (`label` omitted): just the visual box, no
 *   input, no click handling -- use this to show checked/unchecked
 *   state inside something ELSE that already owns the interaction
 *   (e.g. a selectable card already handling its own click/keyboard
 *   and ARIA role).
 */
export function Checkbox({
  checked,
  onChange,
  label,
  name,
  disabled,
  hideLabel,
  className,
  variant = "checkbox",
}: CheckboxProps) {
  const visual = (
    <span className={box({ shape: variant, disabled })} aria-hidden="true">
      {checked && (variant === "checkbox" ? <CheckMark /> : <span className={dot} />)}
    </span>
  );

  if (!label) {
    return <span className={className}>{visual}</span>;
  }

  return (
    <label className={`${wrapper} ${className ?? ""}`.trim()}>
      <input
        type={variant}
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        name={name}
        disabled={disabled}
        className={srOnlyInput}
      />
      {visual}
      <span className={labelText({ hidden: hideLabel })}>{label}</span>
    </label>
  );
}
