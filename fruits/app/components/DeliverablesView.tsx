// The project's Deliverables tab: the pages a guide uploaded for the
// client, one markdown file each, newest change first
// (`deliverables.server.ts`). Everyone with the tab reads the list; a
// manager (a Guide on the project, or staff) uploads, replaces in place
// (same id, so the same link) and flips each file's public link. The
// server refuses all three for anyone else; `manage` only hides them.
import { useRef, useState, type DragEvent } from "react";
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
  // After an upload from outside: the picture paths the markdown named
  // that weren't in the upload, so the Guide knows what to add in the
  // editor. Shown once, cleared by the next upload.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  const send = async (url: string, form: FormData): Promise<{ fileId?: string; unmatched?: string[] } | null> => {
    setBusy(true);
    setError(null);
    setUnmatched([]);
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; fileId?: string; unmatched?: string[] };
      if (!res.ok) {
        setError(data.error ?? "That didn't save. Try again.");
        return null;
      }
      setUnmatched(data.unmatched ?? []);
      onChanged();
      return data;
    } catch {
      setError("That didn't save. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** One markdown file with its pictures, picked or dropped together. */
  const upload = (files: File[]) => {
    if (files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("file", f);
    void send(`/api/projects/${projectFolderId}/deliverables`, form);
  };

  /** An empty deliverable with a title, opened in the editor. */
  const create = async () => {
    const name = window.prompt("What is this deliverable called?", "")?.trim();
    if (!name) return;
    const form = new FormData();
    form.append("name", name);
    const data = await send(`/api/projects/${projectFolderId}/deliverables`, form);
    if (data?.fileId) window.location.assign(`/vault?file=${data.fileId}`);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!manage) return;
    e.preventDefault();
    upload(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={sprinkles({ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 })}
      aria-label="Deliverables"
      onDragOver={manage ? (e) => e.preventDefault() : undefined}
      onDrop={manage ? onDrop : undefined}
    >
      {manage && (
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
          <input
            ref={uploadInput}
            type="file"
            multiple
            accept=".md,text/markdown,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = "";
              upload(files);
            }}
          />
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => void create()}>
            New deliverable
          </button>
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => uploadInput.current?.click()}>
            Upload a deliverable
          </button>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            A markdown file, with its pictures alongside. Or drop them here.
          </span>
        </div>
      )}
      {error && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </p>
      )}
      {unmatched.length > 0 && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }} role="status" data-unmatched-pictures>
          {unmatched.length === 1 ? "One picture wasn't in the upload" : `${unmatched.length} pictures weren't in the upload`}: {unmatched.join(", ")}. Add them in the editor.
        </p>
      )}
      {rows.length === 0 ? (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          No deliverables yet.
        </p>
      ) : (
        <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 4 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <DeliverableRowView
              key={row.fileId}
              row={row}
              manage={manage}
              openInVault={openInVault}
              busy={busy}
              onReplace={(file) => {
                const form = new FormData();
                form.append("file", file);
                void send(`/api/vault/replace/${row.fileId}`, form);
              }}
              onChanged={onChanged}
            />
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
  const vaultPath = `/vault?file=${row.fileId}`;
  // The title opens exactly what the client sees (Austin, 2026-10-21): the
  // public page. With the link off that page admits a manager as a
  // preview, so a manager's title always goes there; a reader's title is
  // a link only once it's shared. The raw file is "Edit".
  const href = row.sharedAt || manage ? publicPath : null;
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
          {openInVault && (
            <a href={vaultPath} className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
              Edit
            </a>
          )}
        </div>
      )}
    </li>
  );
}
