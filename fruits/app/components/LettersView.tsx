// The project's Letters tab: the pages a guide uploaded for the
// client, one markdown file each, newest change first
// (`letters.server.ts`). Everyone with the tab reads the list; a
// manager (a Guide on the project, or staff) uploads, replaces in place
// (same id, so the same link) and flips each file's public link. The
// server refuses all three for anyone else; `manage` only hides them.
import { useRef, useState, type DragEvent } from "react";
import type { LetterRow } from "robustness-core/data/letters.server";
import type { LetterPdfState } from "robustness-core/data/letterPdf.server";

/** A row as the tab receives it: the file, plus (for a manager, while
 * the link is on) what became of its PDF. */
export type LetterTabRow = LetterRow & { pdf: LetterPdfState | null };

/** The PDF line a manager reads under a shared file. Plain words; the
 * reason is the worker's own. */
export function pdfLine(pdf: LetterPdfState): string {
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
import { Input } from "stamps/Input";
import { Modal } from "stamps/Modal";
import { Stack } from "stamps/Stack";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { ShareLinkControl } from "./ShareLinkControl";
import { dayLabel } from "./dayLabel";
import { BRIEF_RUN_NOTE } from "./LetterBrief";
import { localDateString } from "./TodayLog";

export function letterPublicPath(fileId: string): string {
  return `/public/letter/${fileId}`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function LettersView({
  projectFolderId,
  rows,
  manage,
  openInVault,
  onChanged,
}: {
  projectFolderId: string;
  rows: LetterTabRow[];
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
    void send(`/api/projects/${projectFolderId}/letters`, form);
  };

  // "New letter" asks for a title and what the letter is for (Austin,
  // 2026-10-22). The purpose line is the guide's words: the route keeps
  // it on the letter and puts it in the graph in their name, dated the
  // day on this device, the daily log's rule.
  const [starting, setStarting] = useState(false);

  /** An empty letter with a title and a purpose, opened in the editor. */
  const create = async (name: string, purpose: string) => {
    const form = new FormData();
    form.append("name", name);
    form.append("purpose", purpose);
    form.append("date", localDateString());
    const data = await send(`/api/projects/${projectFolderId}/letters`, form);
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
      aria-label="Letters"
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
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => setStarting(true)}>
            New letter
          </button>
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => uploadInput.current?.click()}>
            Upload a letter
          </button>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            A markdown file, with its pictures alongside. Or drop them here.
          </span>
        </div>
      )}
      {manage && (
        <NewLetterModal
          open={starting}
          busy={busy}
          error={error}
          onClose={() => setStarting(false)}
          onStart={(name, purpose) => void create(name, purpose)}
        />
      )}
      {error && !starting && (
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
          No letters yet.
        </p>
      ) : (
        <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 4 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <LetterRowView
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

/** Two fields and one button. The title names the file; the purpose line
 * is one sentence the guide writes, and it is theirs in the project's
 * record from that day. Both are required: a letter starts with what it
 * is for. */
export function NewLetterModal({
  open,
  busy,
  error,
  onClose,
  onStart,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onStart: (name: string, purpose: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="New letter">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const purpose = String(form.get("purpose") ?? "").trim();
          if (!name || !purpose) return;
          onStart(name, purpose);
        }}
      >
        <Stack gap={3}>
          <Input name="name" label="Title" required autoFocus />
          <Input type="textarea" name="purpose" label="What is this letter for?" required />
          <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }}>
            A sentence or three, in your words: what the letter is about, what it has to settle, and for whom. It goes into the project's record as yours, today, and the brief is written from it.
          </p>
          <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-brief-run-note>
            {BRIEF_RUN_NOTE}
          </p>
          {error && (
            <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
              {error}
            </p>
          )}
          <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 })}>
            <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={button({ variant: "primary" })} disabled={busy}>
              {busy ? "Starting…" : "Start the letter"}
            </button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}

function LetterRowView({
  row,
  manage,
  openInVault,
  busy,
  onReplace,
  onChanged,
}: {
  row: LetterTabRow;
  manage: boolean;
  openInVault: boolean;
  busy: boolean;
  onReplace: (file: File) => void;
  onChanged: () => void;
}) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const publicPath = letterPublicPath(row.fileId);
  const vaultPath = `/vault?file=${row.fileId}`;
  // The title opens exactly what the client sees (Austin, 2026-10-21): the
  // letter's page. Before the send that page admits a manager as a
  // preview, so a manager's title always goes there; a reader's title is
  // a link only once it's sent. The raw file is "Edit".
  const href = row.sentDate || manage ? publicPath : null;
  const title = href ? (
    <a href={href} className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ color: "inherit" }}>
      {row.title}
    </a>
  ) : (
    <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{row.title}</span>
  );
  return (
    <li className={sprinkles({ display: "flex", flexDirection: "column", gap: 1.5 })} data-letter={row.fileId}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
        {title}
        <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          {row.name} · updated {longDate(row.updatedAt)}
        </span>
        {row.sentDate && (
          <Badge variant="success">
            Sent {dayLabel(row.sentDate)}
            {row.sentCount > 1 && ", updated"}
          </Badge>
        )}
        {manage && row.editedSinceSent && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-edited-since>
            edited since
          </span>
        )}
        {row.sharedAt && <Badge variant="neutral">Link on</Badge>}
      </div>
      {row.purpose && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }} data-letter-purpose>
          {row.purpose}
        </p>
      )}
      {manage && row.pdf && (
        <p className={textSize.xs} style={{ margin: 0, color: row.pdf.state === "failed" ? semanticColors.textDanger : semanticColors.textSubtle }} data-pdf-state={row.pdf.state}>
          {pdfLine(row.pdf)}
        </p>
      )}
      {manage && (
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
          {row.sentDate ? (
            <ShareLinkControl what="this letter" path={publicPath} endpoint={`/api/letter/${row.fileId}/share`} sharedAt={row.sharedAt} onChanged={onChanged} />
          ) : (
            <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-send-first>
              Send it first. The link is a second step.
            </span>
          )}
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
