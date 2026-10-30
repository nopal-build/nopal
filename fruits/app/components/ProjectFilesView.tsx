// The project's files as four folders that are views, not places: see
// `fileFolders.server.ts` for what a row is and who decided each part of
// it. Rendered inside the Vault's project folder (`routes/vault.tsx`),
// which is where people look for files (Austin, 2026-09-22). Gallery
// uses the Vault's own gallery grid; a video is a real player with its
// poster, never a link that downloads.
import { Link, useSearchParams } from "react-router";
import { useState, type CSSProperties } from "react";
import type { FileFolder, ProjectFileRow } from "robustness-core/data/fileFolders.server";
import type { FilingKind } from "robustness-core/data/syncFiling.server";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
import { SearchField } from "stamps/SearchField";
import { MoreMenu } from "stamps/MoreMenu";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { useLoadFailed } from "../oxmarkdown/useLoadFailed";
// The gallery grid's own rules. Without this import the grid only held
// when a Vault page had loaded the sheet earlier in the visit; a fresh
// load of the Photos tab laid each thumbnail out at its own size
// (2026-10-02).
import "../styles/vault.css";

const FOLDER_TITLES: Record<FileFolder, string> = {
  gallery: "Gallery",
  documents: "Documents",
  costs: "Costs",
  unsorted: "Unsorted",
};

/** What a person is looking for on each tab (Austin, 2026-09-29): the
 * search and the empty state say "photo", not "file", on the Gallery. */
const FOLDER_WORDS: Record<FileFolder, { find: string; none: string; noMatch: string }> = {
  gallery: { find: "Find a photo…", none: "No photos yet.", noMatch: "No photo matches" },
  documents: { find: "Find a document…", none: "No documents yet.", noMatch: "No document matches" },
  costs: { find: "Find a receipt…", none: "No costs yet.", noMatch: "No receipt matches" },
  unsorted: { find: "Find a file…", none: "Nothing unsorted.", noMatch: "Nothing unsorted matches" },
};

/** URL state: `files=<folder>` and `q=<search>`, kept beside whatever
 * else is in the query (the Vault's own `folder=`). */
export const FILES_PARAM = "files";
export const QUERY_PARAM = "q";

export function ProjectFilesView({
  projectFolderId,
  rows,
  folders,
  kinds,
  onOpen,
  onChanged,
  canFile = true,
  canCaption = false,
}: {
  projectFolderId: string;
  rows: ProjectFileRow[];
  folders: readonly FileFolder[];
  kinds: readonly FilingKind[];
  /** Open one file in the viewer (the Vault's `?file=`). */
  onOpen: (row: ProjectFileRow) => void;
  /** Reload after a tap wrote a mark. */
  onChanged: () => void;
  /** The viewer's group gets `edit`: without it, no File as, Correct or
   * Accepted (the server refuses them anyway). */
  canFile?: boolean;
  /** The viewer's group gets `marks`: a "Caption" control on each photo
   * in the Gallery (the server refuses without it anyway). */
  canCaption?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get(FILES_PARAM);
  // The first folder given is the default (the Vault gives all four,
  // Gallery first; a project tab may give only Documents and Unsorted).
  const active: FileFolder = folders.includes(requested as FileFolder) ? (requested as FileFolder) : folders[0];
  const q = params.get(QUERY_PARAM) ?? "";
  const counts = Object.fromEntries(folders.map((f) => [f, rows.filter((r) => r.folders.includes(f)).length])) as Record<FileFolder, number>;
  const shown = rows.filter((r) => r.folders.includes(active) && matches(r, q)).sort((a, b) => b.date.localeCompare(a.date));

  const hrefFor = (folder: FileFolder) => {
    const next = new URLSearchParams(params);
    next.set(FILES_PARAM, folder);
    if (!q) next.delete(QUERY_PARAM);
    return `?${next.toString()}`;
  };

  return (
    <section className={sprinkles({ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 })} aria-label="Files by kind">
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 })}>
        {folders.length > 1 && folders.map((f) => (
          <Link key={f} to={hrefFor(f)} style={{ textDecoration: "none" }}>
            <Chip active={f === active}>
              {FOLDER_TITLES[f]} · {counts[f]}
            </Chip>
          </Link>
        ))}
        <form
          method="get"
          className={sprinkles({ display: "flex", alignItems: "flex-end", gap: 2 })}
          onSubmit={(e) => {
            e.preventDefault();
            const value = String(new FormData(e.currentTarget).get(QUERY_PARAM) ?? "").trim();
            setParams((prev) => {
              const next = new URLSearchParams(prev);
              if (value) next.set(QUERY_PARAM, value);
              else next.delete(QUERY_PARAM);
              next.set(FILES_PARAM, active);
              return next;
            });
          }}
        >
          {/* The stamp search bar; Enter searches. */}
          <SearchField name={QUERY_PARAM} label={FOLDER_WORDS[active].find} placeholder={FOLDER_WORDS[active].find} defaultValue={q} />
        </form>
      </div>

      {shown.length === 0 ? (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          {q ? `${FOLDER_WORDS[active].noMatch} “${q}”.` : FOLDER_WORDS[active].none}
        </p>
      ) : active === "gallery" ? (
        <GalleryGrid rows={shown} onOpen={onOpen} projectFolderId={projectFolderId} canCaption={canCaption} onChanged={onChanged} />
      ) : (
        <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shown.map((row) => (
            <FileRow key={row.fileId} row={row} projectFolderId={projectFolderId} kinds={kinds} onOpen={onOpen} onChanged={onChanged} canFile={canFile} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Vault's own gallery grid (`vault.css`, `.vault-gallery-grid`). A
 * photo opens in the viewer; a video plays here, with its poster. Under
 * each, the captions people have written on it, and for anyone who can
 * mark the project, a control to write one (`PhotoCaptions`). */
function GalleryGrid({
  rows,
  onOpen,
  projectFolderId,
  canCaption,
  onChanged,
}: {
  rows: ProjectFileRow[];
  onOpen: (row: ProjectFileRow) => void;
  projectFolderId: string;
  canCaption: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="vault-gallery-grid">
      {rows.map((row) => (
        <figure key={row.fileId} className="vault-gallery-item" style={{ margin: 0 }}>
          {row.contentType.startsWith("video/") ? (
            <>
              <video controls preload="metadata" poster={row.urls.poster ?? undefined} src={row.urls.original} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 4, background: "var(--farground)" }} />
              <span className="vault-gallery-item-name">{row.caption || row.name}</span>
            </>
          ) : (
            <button type="button" onClick={() => onOpen(row)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}>
              <Thumb src={row.urls.thumb} alt={row.caption || row.name} missingStyle={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4 }} />
              <span className="vault-gallery-item-name">{row.caption || row.name}</span>
            </button>
          )}
          <PhotoCaptions row={row} projectFolderId={projectFolderId} canCaption={canCaption} onChanged={onChanged} />
        </figure>
      ))}
    </div>
  );
}

/** A person's own words on a photo already on the project (Austin,
 * 2026-10-22 and 2026-10-29): "that person's comment about the photo,
 * not a statement about the photo from the person who uploaded it". Each
 * is a file mark with no act (`/api/graphlog/file-marks`, `text`), dated
 * the day it was written and credited to its writer, so several people
 * can each caption one photo, a seeded one included. It reaches the
 * graph through the marks projection, as that person's highlighted
 * words, and sync-graph puts the photo on the node it makes
 * (`markedFileFor`). Not Card text: a Card can't carry a photo its
 * writer doesn't own without copying it a second time (ADR-019). */
export function PhotoCaptions({
  row,
  projectFolderId,
  canCaption,
  onChanged,
}: {
  row: Pick<ProjectFileRow, "fileId" | "acts">;
  projectFolderId: string;
  canCaption: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captions = row.acts.filter((a) => !a.act);

  const save = async () => {
    const words = text.trim();
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/graphlog/file-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectFolderId, fileId: row.fileId, date: localDate(), text: words }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The caption didn't save. Try again.");
        return;
      }
      setText("");
      setOpen(false);
      onChanged();
    } catch {
      setError("The caption didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (captions.length === 0 && !canCaption) return null;
  return (
    <figcaption className={`${textSize.xs} ${sprinkles({ display: "flex", flexDirection: "column", gap: 1, marginTop: 1 })}`} data-photo-captions>
      {captions.map((c) => (
        <span key={c.id}>
          <span style={{ color: semanticColors.textSubtle }}>{c.authorName}:</span> {c.text}
        </span>
      ))}
      {canCaption && !open && (
        <button type="button" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer", color: semanticColors.textSubtle, textDecoration: "underline" }}>
          Caption
        </button>
      )}
      {canCaption && open && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What does this show?"
            aria-label="Caption this photo"
            className={textSize.sm}
            style={{ width: "100%", boxSizing: "border-box" }}
            autoFocus
          />
          <span className={sprinkles({ display: "flex", gap: 2 })}>
            <button type="button" disabled={busy || !text.trim()} className={button({ variant: "outline" })} onClick={() => void save()}>
              Save
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: semanticColors.textSubtle }}>
              Cancel
            </button>
          </span>
        </>
      )}
      {error && (
        <span style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </span>
      )}
    </figcaption>
  );
}

const ROW_THUMB = { width: 96, height: 96, objectFit: "cover", borderRadius: 8, display: "block" } as const;

/** A thumbnail, or a plain tile of the same size when it will not load
 * (`useLoadFailed`): a video's poster before the worker has made it, a
 * file gone since. Never the browser's broken-image icon. */
function Thumb({ src, alt, style, missingStyle }: { src: string | undefined; alt: string; style?: CSSProperties; missingStyle: CSSProperties }) {
  const load = useLoadFailed(src);
  if (!src || load.failed) return <div role="img" aria-label={alt} style={{ ...missingStyle, background: semanticColors.surfaceInset }} />;
  return <img ref={load.ref} onError={load.onError} src={src} alt={alt} loading="lazy" style={style} />;
}

function FileRow({
  row,
  projectFolderId,
  kinds,
  onOpen,
  onChanged,
  canFile,
}: {
  row: ProjectFileRow;
  projectFolderId: string;
  kinds: readonly FilingKind[];
  onOpen: (row: ProjectFileRow) => void;
  onChanged: () => void;
  canFile: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/graphlog/file-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectFolderId, fileId: row.fileId, date: localDate(), ...body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That didn't go through. Try again.");
        return;
      }
      onChanged();
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const isImage = row.contentType.startsWith("image/");
  const isVideo = row.contentType.startsWith("video/");
  const kindBy =
    row.kindSource === "person"
      ? "filed by a person"
      : row.kindSource === "model"
        ? "the model's reading"
        : row.kindSource === "code"
          ? "kept as a file, not read"
          : "not filed yet";

  return (
    <li className={sprinkles({ display: "flex", gap: 4, alignItems: "flex-start" })}>
      <button type="button" onClick={() => onOpen(row)} style={{ flexShrink: 0, background: "none", border: 0, padding: 0, cursor: "pointer" }} aria-label={`Open ${row.name}`}>
        {isImage ? (
          <Thumb src={row.urls.thumb} alt={row.caption || row.name} style={ROW_THUMB} missingStyle={ROW_THUMB} />
        ) : isVideo ? (
          <Thumb src={row.urls.poster ?? undefined} alt={row.caption || row.name} style={{ ...ROW_THUMB, background: semanticColors.surfaceInset }} missingStyle={ROW_THUMB} />
        ) : (
          <div
            className={`${textSize.xs} ${sprinkles({ display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "mono" })}`}
            style={{ width: 96, height: 96, borderRadius: 8, background: semanticColors.surfaceInset, color: semanticColors.textSubtle }}
          >
            {extensionOf(row.name)}
          </div>
        )}
      </button>

      <div className={sprinkles({ display: "flex", flexDirection: "column", gap: 1.5 })} style={{ minWidth: 0, flex: 1 }}>
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
          <button type="button" onClick={() => onOpen(row)} className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit" }}>
            {row.name}
          </button>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {row.authorName} · {row.date}
          </span>
          <Badge variant={row.kindSource === "person" ? "accent" : row.kindSource === "none" ? "warning" : "neutral"}>{row.kind}</Badge>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {kindBy}
          </span>
        </div>

        {row.caption && <p className={textSize.sm}>{row.caption}</p>}
        {!row.caption && row.context && (
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            {row.context}
          </p>
        )}
        {row.reason && (
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {row.reason}
          </p>
        )}

        {row.cost && (
          <div className={`${textSize.sm} ${sprinkles({ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 3 })}`} style={{ borderLeft: `2px solid ${semanticColors.surfaceBorder}` }}>
            <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
              <span className={sprinkles({ fontWeight: "medium" })}>{row.cost.vendor ?? "vendor not read"}</span>
              <span className={sprinkles({ fontFamily: "mono" })}>{row.cost.amount ? `${row.cost.amount} ${row.cost.currency ?? ""}` : "amount not read"}</span>
              <span style={{ color: semanticColors.textSubtle }}>{row.cost.date ?? "no date on the document"}</span>
              <Badge variant={row.cost.status === "unconfirmed" ? "warning" : "success"}>{row.cost.status}</Badge>
              {row.cost.by && (
                <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                  by {row.cost.by}, {row.cost.on}
                </span>
              )}
            </div>
            {row.cost.readFrom.length > 0 && (
              <ul className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`} style={{ color: semanticColors.textSubtle, margin: 0, paddingLeft: 16 }}>
                {row.cost.readFrom.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            {canFile && row.cost.status === "unconfirmed" && row.cost.amount && (
              <div className={sprinkles({ display: "flex", gap: 2, marginTop: 1 })}>
                <button type="button" disabled={busy} className={button({ variant: "outline" })} onClick={() => act({ act: { kind: "confirm-cost", verdict: "correct" } })}>
                  Correct
                </button>
                <button type="button" disabled={busy} className={button({ variant: "outline" })} onClick={() => act({ act: { kind: "confirm-cost", verdict: "accepted" } })}>
                  Accepted
                </button>
              </div>
            )}
          </div>
        )}

        {(row.efforts.length > 0 || row.threads.length > 0) && (
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {row.efforts.length > 0 ? `Effort: ${row.efforts.join(", ")}` : `Thread: ${row.threads.join(", ")}`}
          </p>
        )}

        {row.acts.length > 0 && (
          <ul className={textSize.xs} style={{ color: semanticColors.textSubtle, margin: 0, paddingLeft: 16 }}>
            {row.acts.map((a) => (
              <li key={a.id}>
                {a.authorName}, {a.date}: {a.text}
              </li>
            ))}
          </ul>
        )}

        {canFile && <div className={sprinkles({ display: "flex", alignItems: "center", gap: 2, marginTop: 1 })}>
          <MoreMenu
            label="File as"
            trigger={({ toggle, open }) => (
              <Chip active={open} onClick={toggle}>
                File as…
              </Chip>
            )}
            items={kinds.map((k) => ({ label: k, onClick: () => void act({ act: { kind: "file-as", fileKind: k } }) }))}
          />
          {error && (
            <span className={textSize.xs} style={{ color: semanticColors.textDanger }}>
              {error}
            </span>
          )}
        </div>}
      </div>
    </li>
  );
}

/** Case-insensitive substring over what a person might remember a file
 * by. Mirrors `matchesQuery` in `fileFolders.server.ts`, kept here so
 * the component needs no server import. */
function matches(row: ProjectFileRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.caption, row.context, row.description ?? "", row.reason ?? "", row.cost?.vendor ?? "", ...(row.cost?.readFrom ?? []), row.authorName, row.kind, ...row.threads, ...row.efforts]
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
}

/** The person's own calendar day, which is what a mark is dated with. */
function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
