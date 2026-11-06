// app/components/CopyLinkButton.tsx
// Lifted out of `routes/vault.tsx` unchanged (2026-11-06): a letter's
// writing page at the project's desk shows it too (`LetterWriting`).
import { useState } from "react";
import "../styles/vault.css";

/**
 * Standalone icon button for copying a /public/... link — deliberately
 * NOT buried in the More Actions menu, since "grab the link" is the most
 * common thing to do with published content. Shows a checkmark + "Copied"
 * inline for a moment instead of a window.alert.
 */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    // Built at click time (client-only) rather than render time — `window`
    // doesn't exist during SSR.
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (older browser, non-HTTPS, etc).
      window.prompt("Copy this public link:", url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className="vault-toolbar-btn"
      onClick={handleClick}
      title="Copy public link"
      aria-label="Copy public link"
      style={{ display: "flex", alignItems: "center", gap: "5px" }}
    >
      {copied ? (
        <>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5l10 -10" />
          </svg>
          Copied
        </>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M9 15l6 -6" />
          <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
          <path d="M13 18l-.463 .536a5 5 0 0 1 -7.072 -7.072l.534 -.464" />
        </svg>
      )}
    </button>
  );
}
