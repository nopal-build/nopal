// A public link's switch: share, copy, stop. One element for every
// export view (the Efforts page, a deliverable); the caller says what is
// being shared, where its public page is and which route flips it.
// Quiet: an occasional control, not part of the page's headline. The
// server decides who may flip it; the caller decides who sees it.
import { useState } from "react";
import { Cluster } from "stamps/Cluster";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export function ShareLinkControl({
  what,
  path,
  endpoint,
  sharedAt,
  onChanged,
}: {
  /** Named in the confirm: "this project's Efforts page", "this deliverable". */
  what: string;
  /** The public page's path, e.g. `/public/deliverable/<id>`. */
  path: string;
  /** POST turns the link on, DELETE off. */
  endpoint: string;
  sharedAt: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Set when the clipboard refused: the link, shown to copy by hand.
  const [manual, setManual] = useState<string | null>(null);

  const setShared = async (on: boolean) => {
    if (on && !window.confirm(`Anyone with the link will be able to read ${what} without logging in. Share it?`)) return;
    setBusy(true);
    try {
      await fetch(endpoint, { method: on ? "POST" : "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    // Built at click time: `window` doesn't exist during SSR.
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (plain http, an old browser).
      setManual(url);
    }
  };

  const quiet = {
    background: "transparent",
    border: "none",
    color: semanticColors.textSubtle,
    padding: 0,
    cursor: "pointer",
  } as const;

  if (!sharedAt) {
    return (
      <button type="button" className={textSize.xs} style={quiet} disabled={busy} onClick={() => setShared(true)}>
        Share link
      </button>
    );
  }
  return (
    <Cluster gap={3} align="center" data-share-link>
      {manual ? (
        <input readOnly value={manual} className={textSize.xs} onFocus={(e) => e.currentTarget.select()} autoFocus />
      ) : (
        <button type="button" className={textSize.xs} style={quiet} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      )}
      <button type="button" className={textSize.xs} style={quiet} disabled={busy} onClick={() => setShared(false)}>
        Stop sharing
      </button>
    </Cluster>
  );
}
