import { FocusEventHandler } from "react";

type InputProps = {
  type?: "text" | "textarea" | "dropdown";
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
          style={{ maxHeight: "40px" }}
          type={type || "text"}
          {...commonProps}
        />
      )}
    </div>
  );
}
