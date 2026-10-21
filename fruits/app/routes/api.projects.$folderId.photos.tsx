import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { isStaff } from "robustness-core/data/humans.server";
import { featuresOf } from "robustness-core/data/features";
import { loadProjectFiles } from "robustness-core/data/fileFolders.server";
import { isReachablePhoto, rowsForReader } from "robustness-core/data/projectView.server";

/**
 * GET /api/projects/:folderId/photos
 *
 * The project's photos as the Photos tab shows them (`fileFolders.server.ts`:
 * a projection of what has been documented on the daily logs, each served
 * by the project's own copy), for the deliverable editor's picture picker
 * (`ProjectPhotoPicker`): a Guide building a deliverable here draws on
 * what is already uploaded rather than uploading it twice. The Photos
 * tab's own feature gates it (`photos` on the viewer's role; staff read as
 * a Guide), and the rows are the reader's rows, never more. A refusal
 * reads like a project that isn't there.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const folder = params.folderId ? await getFolderById(params.folderId) : null;
  if (!folder || !(await isProjectFolder(folder))) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  const features = role?.features ?? (isStaff(user) ? featuresOf("Guide") : []);
  if (!features.includes("photos")) return Response.json({ error: "Project not found" }, { status: 404 });

  const rows = rowsForReader(await loadProjectFiles(folder), features)
    .filter((r) => isReachablePhoto(r, features) && r.contentType.startsWith("image/"))
    .sort((a, b) => b.date.localeCompare(a.date));
  return Response.json({
    photos: rows.map((r) => ({ id: r.serveId, name: r.name, caption: r.caption, date: r.date, thumb: r.urls.thumb, display: r.urls.display })),
  });
}
