// packages/stamps/src/Select.tsx
import { useId, type ChangeEvent } from "react";
import { label as labelRecipe, wrapper } from "./input.css";
import { chevron, selectField, selectWrapper } from "./select.css";

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  /** Always given, for screen readers; shown unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  name: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** A first, unchoosable option that says what to pick ("a project"). */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** `small` sits in a row of text; `normal` beside an `Input`. */
  size?: "normal" | "small";
  className?: string;
};

/**
 * The stamp dropdown (Austin, 2026-09-28): a native `<select>`, so the
 * keyboard, a phone's own picker and a wrapping `<form>` all work, drawn
 * as the stamp field with its own chevron. Use it wherever a person picks
 * one of a few known values.
 */
export function Select({
  label,
  hideLabel,
  name,
  options,
  value,
  defaultValue,
  onChange,
  placeholder,
  required,
  disabled,
  size = "normal",
  className,
}: SelectProps) {
  const id = useId();
  return (
    <div className={wrapper}>
      <label className={labelRecipe({ hidden: hideLabel })} htmlFor={id}>
        {label}
      </label>
      <div className={selectWrapper}>
        <select
          id={id}
          name={name}
          value={value}
          defaultValue={value === undefined ? (defaultValue ?? (placeholder ? "" : undefined)) : undefined}
          onChange={onChange}
          required={required}
          disabled={disabled}
          className={[selectField({ size }), className].filter(Boolean).join(" ")}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          width={size === "small" ? 12 : 14}
          height={size === "small" ? 12 : 14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={chevron({ size })}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
}
