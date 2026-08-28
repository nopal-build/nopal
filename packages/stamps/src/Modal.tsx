// packages/stamps/src/Modal.tsx
import { useEffect, type ReactNode } from "react";
import { Surface } from "./Surface";
import { backdrop, closeButton, header, panel, title } from "./modal.css";

/**
 * A minimal, dependency-free modal: a full-screen backdrop plus a centered
 * `Surface` panel. Closes on Escape or backdrop click.
 */
export function Modal({
  open,
  onClose,
  title: titleText,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={backdrop} onClick={onClose}>
      <Surface
        className={panel}
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={header}>
          {titleText && <h2 className={title}>{titleText}</h2>}
          {/* `.link` is still a plain global CSS class (root.css) — not
              yet ported to `stamps`, but still valid, so referencing it
              here alongside the new vanilla-extract classes is fine. */}
          <button
            type="button"
            className={`link ${closeButton}`}
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </Surface>
    </div>
  );
}
