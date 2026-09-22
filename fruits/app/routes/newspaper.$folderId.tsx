// app/routes/newspaper.$folderId.tsx
// The Project Newspaper — the rolled-up view of one project folder (under
// the `projects` vault root), driven by the manifest front matter on its
// README.md — see `app/data/project.types.ts` for the manifest grammar and
// `app/data/project.server.ts` for how it's resolved. See also the
// `project-newspaper` skill.
//
// Lives at `/newspaper/:folderId` — was previously
// `fruits_.projects.$folderId.tsx` (renamed once this became the project's
// single detail page, rather than living alongside a separate
// OxMarkdown-based prototype at a `.../newspaper` sub-path).
//
// Gated ONLY on the viewer's ACCESS to the folder (`canViewFolder` below) —
// never on whether the README happens to have valid manifest front matter
// yet. `resolveProjectManifest` never fails closed (see its own doc), so
// anyone who can view this folder always sees this route; there's no
// redirect-to-vault fallback to worry about missing here.
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import { useCallback, useMemo, useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { pageHash } from "robustness-core/data/pageBody.server";
import { listMarksOnPage, readableMark } from "robustness-core/data/graphLogMarks.server";
import { resolveProjectManifest } from "robustness-core/data/project.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";
import { isIncompleteBannerText, type ProjectStatus } from "robustness-core/data/project.types";
import { AppLayout } from "../components/AppLayout";
import { ProjectView } from "../components/ProjectView";
import type { MoveOptions, OxAnnotations } from "../oxmarkdown/marks";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const folderId = params.folderId;
  if (!folderId) throw new Response("Not found", { status: 404 });

  const folder = await getFolderById(folderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    throw new Response("Not found", { status: 404 });
  }

  // Children/README belong to the folder's OWNER, not necessarily the viewer
  // (this folder may only be reachable because it's shared with them).
  const project = await resolveProjectManifest(folder.human_id, folder);

  // The pen. There is one page and no archive (Austin, 2026-09-21): a
  // mark sits beside its words while they are on the page, and an unread
  // one whose passage was rewritten re-anchors and says it is waiting.
  // See `graphLogMarks.server.ts`.
  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  const livePageHash = pageHash(readme?.content ?? "");
  // A mark that asked for a move usually names the project it named ("this
  // belongs to Coronado"). Whoever can open that project reads the mark as
  // written; to everyone else the project's existence is not theirs to
  // learn (Austin, 2026-09-21), so they get the same placeholder the
  // graph gets. `moveDestFolderId` never leaves the server.
  const marks = await Promise.all(
    (await listMarksOnPage(folder._id, readme?.content ?? "")).map(async (mark) => {
      const dest = mark.moveDestFolderId ? await getFolderById(mark.moveDestFolderId) : null;
      return readableMark(mark, !!dest && canViewFolder(user._id, dest));
    }),
  );

  return {
    // Every other route surfaces `user` in its own loader data for
    // `useUser()`/`permissions.isAdmin()` to find via `useMatches()` --
    // there's no shared root layout loader that provides it
    // centrally. Omitting it here was a real, confirmed bug: `AppLayout`'s
    // nav silently hid the Maker link (and anything else gated on
    // `isAdmin`) for an Admin/Super viewing this specific page, since
    // `useUser()` found no ancestor match with a `user` key and fell back
    // to `null`.
    user,
    folder,
    project,
    status: getProjectStatus(folder),
    // Status is a personal organizational tool, not a Sharing Role -- only
    // the project's own creator may change it (see `projectStatus.server.ts`).
    canEditStatus: folder.human_id === user._id,
    livePageHash,
    viewerId: user._id,
    marks,
  };
}

/** The writer's own calendar day, which is what a mark is dated with. */
function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ProjectStatusControl({
  folderId,
  status,
}: {
  folderId: string;
  status: ProjectStatus;
}) {
  const revalidator = useRevalidator();
  const [updating, setUpdating] = useState(false);

  const changeStatus = async (next: ProjectStatus) => {
    if (next === status) return;
    setUpdating(true);
    try {
      await fetch(`/api/vault/projects/${folderId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      revalidator.revalidate();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <select
      aria-label="Project status"
      value={status}
      disabled={updating}
      onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
      className="text-xs font-mono"
      style={{
        background: "var(--farground)",
        border: "1px solid var(--midground)",
        color: "inherit",
        borderRadius: "6px",
        padding: "3px 6px",
      }}
    >
      <option value="active">Active</option>
      <option value="completed">Completed</option>
      <option value="trashed">Trashed</option>
    </select>
  );
}

export default function NewspaperRoute() {
  const { folder, project, status, canEditStatus, livePageHash, viewerId, marks } =
    useLoaderData<typeof loader>();
  const { manifest, body, galleryFolders } = project;
  const revalidator = useRevalidator();

  const onSend = useCallback(
    async (unitKey: string, text: string, markId?: string): Promise<string | null> => {
      try {
        // Rewriting one of your own that no run has read yet, or writing
        // a new one. See `api.graphlog.marks.$markId.tsx`.
        const res = markId
          ? await fetch(`/api/graphlog/marks/${markId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            })
          : await fetch("/api/graphlog/marks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectFolderId: folder._id, pageHash: livePageHash, unitKey, text, date: localDate() }),
            });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't save. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't save. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash, revalidator],
  );

  const onErase = useCallback(
    async (markId: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/graphlog/marks/${markId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete" }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't come back. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't come back. Check your connection and try again.";
      }
    },
    [revalidator],
  );

  const loadMoveOptions = useCallback(
    async (unitKey: string): Promise<MoveOptions | string> => {
      try {
        const params = new URLSearchParams({ projectFolderId: folder._id, pageHash: livePageHash, unitKey });
        const res = await fetch(`/api/graphlog/move-options?${params}`);
        const data = (await res.json().catch(() => ({}))) as MoveOptions & { error?: string };
        if (!res.ok) return data.error ?? "Couldn't look that up. Try again.";
        return data;
      } catch {
        return "Couldn't look that up. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash],
  );

  const onMove = useCallback(
    async (input: {
      unitKey: string;
      entryFileId: string;
      section: string | null;
      occurrence: number;
      destProjectFolderId: string;
      text: string;
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/graphlog/moves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, projectFolderId: folder._id, pageHash: livePageHash, date: localDate() }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't file. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't file. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash, revalidator],
  );

  const onMoveAction = useCallback(
    async (moveId: string, action: "confirm" | "undo"): Promise<string | null> => {
      try {
        const res = await fetch(`/api/graphlog/moves/${moveId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't go through. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't go through. Check your connection and try again.";
      }
    },
    [revalidator],
  );

  const annotations = useMemo<OxAnnotations>(
    () => ({
      viewerId,
      marks: marks.map((m) => ({
        id: m.id,
        unitKey: m.unitKey,
        authorHumanId: m.authorHumanId,
        authorName: m.authorName,
        date: m.date,
        text: m.text,
        waiting: m.waiting,
        moved: m.moved,
        move:
          m.moveId && m.moveStatus
            ? {
                id: m.moveId,
                status: m.moveStatus,
                canConfirm: m.moveAuthorHumanId === viewerId,
                canUndo: m.moveAuthorHumanId === viewerId || m.authorHumanId === viewerId,
              }
            : undefined,
      })),
      canMark: true,
      onSend: onSend,
      onErase: onErase,
      loadMoveOptions: loadMoveOptions,
      onMove: onMove,
      onMoveAction,
      skipParagraph: isIncompleteBannerText,
    }),
    [marks, onSend, onErase, loadMoveOptions, onMove, onMoveAction, viewerId],
  );

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <Link
            to="/"
            className="text-xs subtle-text hover:opacity-80"
            style={{ textDecoration: "none" }}
          >
            ← Dashboard
          </Link>
          <div className="flex items-baseline justify-between gap-4 mt-2">
            <h1 className="font-bold text-2xl mb-1">
              {manifest.title ?? folder.name}
            </h1>
            <div className="flex items-center gap-3 shrink-0">
              {canEditStatus ? (
                <ProjectStatusControl folderId={folder._id} status={status} />
              ) : (
                <span className="text-xs subtle-text capitalize">{status}</span>
              )}
              <Link
                to={`/newspaper/${folder._id}/files`}
                className="text-xs subtle-text hover:opacity-80 whitespace-nowrap"
                style={{ textDecoration: "none" }}
              >
                Files →
              </Link>
              <Link
                to={`/vault?folder=${folder._id}`}
                className="text-xs subtle-text hover:opacity-80 whitespace-nowrap"
                style={{ textDecoration: "none" }}
              >
                View as files →
              </Link>
            </div>
          </div>
        </div>

        <ProjectView body={body} galleryFolders={galleryFolders} annotations={annotations} />
      </div>
    </AppLayout>
  );
}
