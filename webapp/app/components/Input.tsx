import { FocusEventHandler } from "react";

type InputProps = {
  type?: "text" | "textarea" | "dropdown" | "date" | "number";
  label: string;
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
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

const DEFAULT_INPUT_CLASSNAME = "border border-gray-300 rounded px-2 py-1";

export function Input(props: InputProps) {
  const { type = "text", name, defaultValue, value, placeholder } = props;

  const commonProps = {
    defaultValue,
    value,
    name,
    onChange: props.onChange,
    onFocus: props.onFocus,
    onBlur: props.onBlur,
    autoComplete: "off",
    required: props.required,
    className: [DEFAULT_INPUT_CLASSNAME, props.className]
      .filter(Boolean)
      .join(" "),
    placeholder,
    autoFocus: props.autoFocus,
  };

  return (
    <div className="flex flex-col input-component">
      <label
        className={`purple-text font-bold${props.hideLabel ? " sr-only" : ""}`}
        htmlFor={name}
      >
        {props.label}
      </label>
      {type == "textarea" ? (
        <textarea
          style={{
            minHeight: "130px",
          }}
          {...commonProps}
        />
      ) : (
        <input
          style={
            // Native `date`/`number` control chrome (the calendar icon,
            // segmented date parts, and up/down spin buttons) needs more
            // vertical room than plain text to render without clipping or
            // overflowing the rounded border — the default 16px vertical
            // padding from `.input-component` leaves almost none at a
            // 40px cap. Trim padding and give those two types a couple
            // extra px of height instead, so the value stays centered and
            // the native chrome has space to render fully inside the box.
            type === "date" || type === "number"
              ? { maxHeight: "42px", padding: "8px" }
              : { maxHeight: "40px" }
          }
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
