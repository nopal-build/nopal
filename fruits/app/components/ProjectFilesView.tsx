// The project's files as four folders that are views, not places: see
// `fileFolders.server.ts` for what a row is and who decided each part of
// it. Rendered inside the Vault's project folder (`routes/vault.tsx`),
// which is where people look for files (Austin, 2026-09-22). Gallery
// uses the Vault's own gallery grid; a video is a real player with its
// poster, never a link that downloads.
import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import type { FileFolder, ProjectFileRow } from "robustness-core/data/fileFolders.server";
import type { FilingKind } from "robustness-core/data/syncFiling.server";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
import { Input } from "stamps/Input";
import { MoreMenu } from "stamps/MoreMenu";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

const FOLDER_TITLES: Record<FileFolder, string> = {
  gallery: "Gallery",
  documents: "Documents",
  costs: "Costs",
  unsorted: "Unsorted",
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
}: {
  projectFolderId: string;
  rows: ProjectFileRow[];
  folders: readonly FileFolder[];
  kinds: readonly FilingKind[];
  /** Open one file in the viewer (the Vault's `?file=`). */
  onOpen: (row: ProjectFileRow) => void;
  /** Reload after a tap wrote a mark. */
  onChanged: () => void;
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
          <Input name={QUERY_PARAM} label="Search files" hideLabel placeholder="Find a file by what it is about…" defaultValue={q} />
          <button type="submit" className={button({ variant: "outline" })}>
            Search
          </button>
        </form>
      </div>

      {shown.length === 0 ? (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          {rows.length === 0
            ? "No files have been attached to this project's daily logs yet."
            : q
              ? `Nothing in ${FOLDER_TITLES[active]} matches “${q}”.`
              : `Nothing in ${FOLDER_TITLES[active]} yet.`}
        </p>
      ) : active === "gallery" ? (
        <GalleryGrid rows={shown} onOpen={onOpen} />
      ) : (
        <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shown.map((row) => (
            <FileRow key={row.fileId} row={row} projectFolderId={projectFolderId} kinds={kinds} onOpen={onOpen} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Vault's own gallery grid (`vault.css`, `.vault-gallery-grid`). A
 * photo opens in the viewer; a video plays here, with its poster. */
function GalleryGrid({ rows, onOpen }: { rows: ProjectFileRow[]; onOpen: (row: ProjectFileRow) => void }) {
  return (
    <div className="vault-gallery-grid">
      {rows.map((row) =>
        row.contentType.startsWith("video/") ? (
          <figure key={row.fileId} className="vault-gallery-item" style={{ margin: 0 }}>
            <video controls preload="metadata" poster={row.urls.poster ?? undefined} src={row.urls.original} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 4, background: "var(--farground)" }} />
            <span className="vault-gallery-item-name">{row.caption || row.name}</span>
          </figure>
        ) : (
          <button key={row.fileId} type="button" className="vault-gallery-item" onClick={() => onOpen(row)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
            <img src={row.urls.thumb} alt={row.caption || row.name} loading="lazy" />
            <span className="vault-gallery-item-name">{row.caption || row.name}</span>
          </button>
        ),
      )}
    </div>
  );
}

function FileRow({
  row,
  projectFolderId,
  kinds,
  onOpen,
  onChanged,
}: {
  row: ProjectFileRow;
  projectFolderId: string;
  kinds: readonly FilingKind[];
  onOpen: (row: ProjectFileRow) => void;
  onChanged: () => void;
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
          <img src={row.urls.thumb} alt={row.caption || row.name} loading="lazy" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, display: "block" }} />
        ) : isVideo ? (
          <img src={row.urls.poster ?? ""} alt={row.caption || row.name} loading="lazy" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, display: "block", background: semanticColors.surfaceInset }} />
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
            {row.cost.status === "unconfirmed" && row.cost.amount && (
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

        <div className={sprinkles({ display: "flex", alignItems: "center", gap: 2, marginTop: 1 })}>
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
        </div>
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
