// app/components/CopyField.tsx
import { useState } from "react";

type CopyFieldProps = {
  /** The full text copied to the clipboard and shown (read-only) in the field. */
  value: string;
  /** Required — there's no visible label, so this is the only accessible name. */
  ariaLabel: string;
  copyLabel?: string;
  copiedLabel?: string;
  /** Applied to the outer flex row, e.g. to change gap or add margin. */
  className?: string;
};

/**
 * A read-only "copy this value" row: field + Copy button, used for install
 * commands, API keys, share links, etc. Falls back gracefully — the field is
 * readOnly and auto-selects on focus/click, so copying by hand always works
 * even if `navigator.clipboard` is unavailable (older browser, non-secure
 * context, permission denied).
 */
export function CopyField({
  value,
  ariaLabel,
  copyLabel = "Copy",
  copiedLabel = "Copied!",
  className = "",
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable — the input is readOnly and
      // auto-selects on focus/click, so manual copy still works.
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        aria-label={ariaLabel}
        className="font-mono flex-1 min-w-0 code-input"
        style={{ fontSize: "0.75rem", padding: "6px 8px" }}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="btn-secondary shrink-0"
        style={{ padding: "6px 12px", fontSize: "0.75rem" }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
