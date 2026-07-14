import { useEffect } from "react";

/**
 * A minimal, dependency-free modal: a full-screen backdrop plus a centered
 * `good-box` panel. Closes on Escape or backdrop click.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
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
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        className="good-box p-4 w-full"
        style={{ maxWidth: "400px" }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h2 className="font-bold text-lg">{title}</h2>}
          <button
            type="button"
            className="link text-sm"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
