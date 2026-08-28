// packages/stamps/src/Input.tsx
import type { FocusEventHandler } from "react";
import { field, label as labelRecipe, wrapper } from "./input.css";

type InputProps = {
  type?: "text" | "textarea" | "dropdown" | "date" | "number";
  label: string;
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  required?: boolean;
  onFocus?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Only meaningful for `type="number"`. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * Visually hides the label (e.g. for compact inline-edit rows that already
   * show a heading elsewhere) while keeping it in the DOM for screen readers.
   */
  hideLabel?: boolean;
};

export function Input(props: InputProps) {
  const { type = "text", name, defaultValue, value, placeholder } = props;

  const isCompact = type === "date" || type === "number";

  const commonProps = {
    defaultValue,
    value,
    name,
    onChange: props.onChange,
    onFocus: props.onFocus,
    onBlur: props.onBlur,
    autoComplete: "off",
    required: props.required,
    placeholder,
    autoFocus: props.autoFocus,
  };

  return (
    <div className={wrapper}>
      <label className={labelRecipe({ hidden: props.hideLabel })} htmlFor={name}>
        {props.label}
      </label>
      {type == "textarea" ? (
        <textarea
          className={`${field({ multiline: true })} ${props.className ?? ""}`.trim()}
          {...commonProps}
        />
      ) : (
        <input
          className={`${field({ density: isCompact ? "compact" : "normal" })} ${
            props.className ?? ""
          }`.trim()}
          type={type || "text"}
          min={props.min}
          max={props.max}
          step={props.step}
          {...commonProps}
        />
      )}
    </div>
  );
}
