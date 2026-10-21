// The project's Deliverables tab: the pages a guide uploaded for the
// client, one markdown file each, newest change first
// (`deliverables.server.ts`). Everyone with the tab reads the list; a
// manager (a Guide on the project, or staff) uploads, replaces in place
// (same id, so the same link) and flips each file's public link. The
// server refuses all three for anyone else; `manage` only hides them.
import { useRef, useState } from "react";
import type { DeliverableRow } from "robustness-core/data/deliverables.server";
import type { DeliverablePdfState } from "robustness-core/data/deliverablePdf.server";

/** A row as the tab receives it: the file, plus (for a manager, while
 * the link is on) what became of its PDF. */
export type DeliverableTabRow = DeliverableRow & { pdf: DeliverablePdfState | null };

/** The PDF line a manager reads under a shared file. Plain words; the
 * reason is the worker's own. */
export function pdfLine(pdf: DeliverablePdfState): string {
  switch (pdf.state) {
    case "ready":
      return "PDF ready";
    case "preparing":
      return "PDF preparing";
    case "failed":
      return `PDF couldn't be made: ${pdf.reason}${pdf.at ? ` (${longDate(pdf.at)})` : ""}`;
    case "none":
      return "PDF not made yet. The next click asks for it.";
  }
}
import { Badge } from "stamps/Badge";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { ShareLinkControl } from "./ShareLinkControl";

export function deliverablePublicPath(fileId: string): string {
  return `/public/deliverable/${fileId}`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DeliverablesView({
  projectFolderId,
  rows,
  manage,
  openInVault,
  onChanged,
}: {
  projectFolderId: string;
  rows: DeliverableTabRow[];
  /** Upload, Replace and the share switch. */
  manage: boolean;
  /** Whether a row opens the Vault's file view; a client has no Vault
   * and opens the public page when there is one. */
  openInVault: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  const send = async (url: string, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That didn't save. Try again.");
        return;
      }
      onChanged();
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={sprinkles({ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 })} aria-label="Deliverables">
      {manage && (
        <div className={sprinkles({ display: "flex", alignItems: "center", gap: 3 })}>
          <input
            ref={uploadInput}
            type="file"
            accept=".md,text/markdown"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void send(`/api/projects/${projectFolderId}/deliverables`, file);
            }}
          />
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => uploadInput.current?.click()}>
            Upload a deliverable
          </button>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            One markdown file. Pictures are vault files it names.
          </span>
        </div>
      )}
      {error && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          No deliverables yet.
        </p>
      ) : (
        <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 4 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <DeliverableRowView key={row.fileId} row={row} manage={manage} openInVault={openInVault} busy={busy} onReplace={(file) => send(`/api/vault/replace/${row.fileId}`, file)} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeliverableRowView({
  row,
  manage,
  openInVault,
  busy,
  onReplace,
  onChanged,
}: {
  row: DeliverableTabRow;
  manage: boolean;
  openInVault: boolean;
  busy: boolean;
  onReplace: (file: File) => void;
  onChanged: () => void;
}) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const publicPath = deliverablePublicPath(row.fileId);
  const href = openInVault ? `/vault?file=${row.fileId}` : row.sharedAt ? publicPath : null;
  const title = href ? (
    <a href={href} className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ color: "inherit" }}>
      {row.title}
    </a>
  ) : (
    <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{row.title}</span>
  );
  return (
    <li className={sprinkles({ display: "flex", flexDirection: "column", gap: 1.5 })} data-deliverable={row.fileId}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
        {title}
        <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          {row.name} · updated {longDate(row.updatedAt)}
        </span>
        {row.sharedAt && <Badge variant="success">Shared</Badge>}
      </div>
      {manage && row.pdf && (
        <p className={textSize.xs} style={{ margin: 0, color: row.pdf.state === "failed" ? semanticColors.textDanger : semanticColors.textSubtle }} data-pdf-state={row.pdf.state}>
          {pdfLine(row.pdf)}
        </p>
      )}
      {manage && (
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
          <ShareLinkControl what="this deliverable" path={publicPath} endpoint={`/api/deliverable/${row.fileId}/share`} sharedAt={row.sharedAt} onChanged={onChanged} />
          <input
            ref={replaceInput}
            type="file"
            accept=".md,text/markdown"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) onReplace(file);
            }}
          />
          <button type="button" className={textSize.xs} disabled={busy} onClick={() => replaceInput.current?.click()} style={{ background: "transparent", border: "none", color: semanticColors.textSubtle, padding: 0, cursor: "pointer" }}>
            Replace
          </button>
        </div>
      )}
    </li>
  );
}
