import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { pageHash } from "robustness-core/data/pageBody.server";
import { pageMarkUnits } from "robustness-core/data/graphLogMarks.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { loadCitedLogs } from "robustness-core/data/citedLogs.server";
import { loadProjectFiles } from "robustness-core/data/fileFolders.server";
import { servedFileIds } from "robustness-core/data/projectView.server";
import { extractFileAttachments } from "robustness-core/data/sorter.server";
import { splitFrontmatter } from "robustness-core/data/project.types";

/**
 * GET /api/graphlog/cited-logs?projectFolderId=&pageHash=&unitKey=
 * GET /api/graphlog/cited-logs?projectFolderId=&pageHash=&fileId=
 *
 * The daily logs a passage on the Efforts page came from, for the pen's
 * "Read the full log": each Card (or seed day) its citations name, as the
 * Logbook shows it (`citedLogs.server.ts`).
 *
 * The Logbook's words, so the Logbook's feature: a role whose group has
 * `logbook` (a Client marks and has no Logbook). Admitted by the role on
 * the list, as the pen is, never by the sharing cache. A refusal reads
 * like a project that isn't there, the same as a typed tab.
 *
 * The passage is found again here from the page as it is; nothing about
 * which files to read comes from the browser. A citation's `*` asks by the
 * one file it names (2026-10-02), which is read only if the page as it is
 * cites it.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const projectFolderId = url.searchParams.get("projectFolderId") ?? "";
  const unitKey = url.searchParams.get("unitKey") ?? "";
  const fileId = url.searchParams.get("fileId") ?? "";
  const hash = url.searchParams.get("pageHash") ?? "";

  const folder = projectFolderId ? await getFolderById(projectFolderId) : null;
  const role = folder ? await getProjectRole(folder, user._id) : null;
  if (!folder || !role?.features.includes("logbook")) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const raw = (await getReadmeFileForFolder(folder.human_id, folder._id))?.content ?? "";
  if (pageHash(raw) !== hash) {
    return Response.json({ error: "This page has been rewritten. Reload it." }, { status: 409 });
  }
  const units = pageMarkUnits(raw);
  const refs = fileId
    ? units.some((u) => u.refs.some((r) => r.fileId === fileId)) ? [{ fileId }] : null
    : units.find((u) => u.key === unitKey)?.refs;
  if (!refs) return Response.json({ error: "That passage isn't on this page." }, { status: 400 });

  const { entries, other } = await loadCitedLogs(folder, refs);

  // A Card names its writer's originals; the reader loads what the file
  // tabs load (`servedFileIds`), only for the files these Cards name.
  const named = new Set(entries.filter((e) => !e.seeded).flatMap((e) => extractFileAttachments(e.content).map((f) => f.fileId)));
  const served = named.size > 0 ? servedFileIds(await loadProjectFiles(folder), role.features) : {};
  const fileIds = Object.fromEntries(Object.entries(served).filter(([id]) => named.has(id)));

  return Response.json({
    entries: entries.map((e) => ({
      fileId: e.fileId,
      who: e.who,
      date: e.date,
      seeded: e.seeded,
      // A seed day without its front matter, as the Logbook shows it.
      markdown: e.seeded ? splitFrontmatter(e.content).body.trim() : e.content,
    })),
    other,
    fileIds,
  });
}
