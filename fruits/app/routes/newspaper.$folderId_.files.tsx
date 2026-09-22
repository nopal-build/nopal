// app/routes/newspaper.$folderId_.files.tsx
// The project's files as four folders (Gallery, Documents, Costs,
// Unsorted), which are views over the daily logs' attachments, never
// places a file is moved to. See `fileFolders.server.ts` for what a row
// is and who decided each part of it. Text first: the layout is Gerald's.
//
// `newspaper.$folderId_.files` (trailing underscore) so this is its own
// page beside `/newspaper/:folderId` rather than nested inside it, which
// has no <Outlet>. Same pattern as `maker_.graphlog_.defaults.tsx`.
import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData, useRevalidator } from "react-router";
import { useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { getFolderById } from "robustness-core/data/vault.server";
import {
  FILE_FOLDERS,
  loadProjectFiles,
  matchesQuery,
  type FileFolder,
  type ProjectFileRow,
} from "robustness-core/data/fileFolders.server";
import { FILING_KINDS, type FilingKind } from "robustness-core/data/syncFiling.server";
// Everything the component needs from the `.server` modules above comes
// through the loader as data; a `.server` value referenced in the
// component would be pulled into the client bundle and refused.
import { AppLayout } from "../components/AppLayout";
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const folderId = params.folderId;
  if (!folderId) throw new Response("Not found", { status: 404 });
  const folder = await getFolderById(folderId);
  if (!folder || !canViewFolder(user._id, folder)) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const requested = url.searchParams.get("folder");
  const active: FileFolder = (FILE_FOLDERS as readonly string[]).includes(requested ?? "") ? (requested as FileFolder) : "gallery";
  const q = url.searchParams.get("q") ?? "";

  /** The kinds a person can file a thing as. `video` is code's. */
  const PERSON_KINDS = FILING_KINDS.filter((k) => k !== "video");

  const t0 = Date.now();
  const all = await loadProjectFiles(folder);
  const counts = Object.fromEntries(FILE_FOLDERS.map((f) => [f, all.filter((r) => r.folders.includes(f)).length])) as Record<FileFolder, number>;
  const rows = all.filter((r) => r.folders.includes(active) && matchesQuery(r, q)).sort((a, b) => b.date.localeCompare(a.date));
  if (process.env.NODE_ENV !== "production") console.log(`files view: ${all.length} file(s) in ${Date.now() - t0}ms`);

  return { user, folder, active, q, counts, rows, total: all.length, viewerId: user._id, folders: FILE_FOLDERS, kinds: PERSON_KINDS };
}

export default function ProjectFilesPage() {
  const { folder, active, q, counts, rows, total, folders, kinds } = useLoaderData<typeof loader>();
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12">
        <div className={sprinkles({ marginBottom: 6 })}>
          <Link to={`/newspaper/${folder._id}`} className="text-xs subtle-text hover:opacity-80" style={{ textDecoration: "none" }}>
            ← {folder.name}
          </Link>
          <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", marginTop: 2 })}`}>Files</h1>
          <p className={`${textSize.sm} ${sprinkles({ marginTop: 1 })}`} style={{ color: semanticColors.textSubtle }}>
            Every file attached to a daily log, by kind. A file stays with the entry it came with; these are views, and one file can sit in two.
          </p>
        </div>

        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, marginBottom: 4 })}>
          {folders.map((f) => (
            <Link key={f} to={`?folder=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`} style={{ textDecoration: "none" }}>
              <Chip active={f === active}>
                {FOLDER_TITLES[f]} · {counts[f]}
              </Chip>
            </Link>
          ))}
        </div>

        <Form method="get" className={sprinkles({ display: "flex", alignItems: "flex-end", gap: 2, marginBottom: 6 })}>
          <input type="hidden" name="folder" value={active} />
          <Input name="q" label="Search" hideLabel placeholder="Find a file by what it is about…" defaultValue={q} />
          <button type="submit" className={button({ variant: "outline" })}>
            Search
          </button>
        </Form>

        {rows.length === 0 ? (
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            {total === 0 ? "No files have been attached to this project's daily logs yet." : q ? `Nothing in ${FOLDER_TITLES[active]} matches “${q}”.` : `Nothing in ${FOLDER_TITLES[active]} yet.`}
          </p>
        ) : (
          <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((row) => (
              <FileRow key={row.fileId} row={row} projectFolderId={folder._id} kinds={kinds} />
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}

function FileRow({ row, projectFolderId, kinds }: { row: ProjectFileRow; projectFolderId: string; kinds: readonly FilingKind[] }) {
  const revalidator = useRevalidator();
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
      revalidator.revalidate();
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const isImage = row.contentType.startsWith("image/");
  const isVideo = row.contentType.startsWith("video/");
  const kindLabel = row.kind === "unfiled" ? "unfiled" : row.kind;
  const kindBy = row.kindSource === "person" ? "filed by a person" : row.kindSource === "model" ? "the model's reading" : "not filed yet";

  return (
    <li className={sprinkles({ display: "flex", gap: 4, alignItems: "flex-start" })}>
      <a href={row.urls.original} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
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
      </a>

      <div className={sprinkles({ display: "flex", flexDirection: "column", gap: 1.5 })} style={{ minWidth: 0, flex: 1 }}>
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
          <a href={row.urls.original} target="_blank" rel="noreferrer" className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>
            {row.name}
          </a>
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {row.authorName} · {row.date}
          </span>
          <Badge variant={row.kindSource === "person" ? "accent" : row.kindSource === "model" ? "neutral" : "warning"}>{kindLabel}</Badge>
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
