import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import {
  getProjectStatus,
  setProjectStatus,
} from "robustness-core/data/projectStatus.server";
import { PROJECT_STATUSES, type ProjectStatus } from "robustness-core/data/project.types";
import { CLIENT_ROLE } from "robustness-core/data/sharingRoles.server";

/**
 * GET/PUT /api/vault/projects/:folderId/status — a project's Active/
 * Completed/Trashed status. See `projectStatus.server.ts` for the
 * underlying model: the project's README.md front matter is the source of
 * truth; `vault_folders.project_status`/`project_status_at` is a derived
 * cache kept in sync by `setProjectStatus`.
 */

async function loadContext(folderId: string, request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { error: Response.json({ error: "Not authenticated" }, { status: 401 }) };

  const folder = await getFolderById(folderId);
  if (!folder) return { error: Response.json({ error: "Not found" }, { status: 404 }) };

  // Anyone who can't reach the project's work gets the same 404 as a
  // project that doesn't exist (this GET used to answer anyone signed in).
  const role = (await isProjectFolder(folder)) ? await getProjectRole(folder, user._id) : null;
  if (!role || role.role === CLIENT_ROLE) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  }

  return { user, folder };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadContext(folderId, request);
  if ("error" in ctx) return ctx.error;

  return Response.json({ status: getProjectStatus(ctx.folder) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadContext(folderId, request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json()) as { status?: ProjectStatus };
  if (!body.status || !PROJECT_STATUSES.includes(body.status)) {
    return Response.json(
      { error: `status must be one of: ${PROJECT_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const result = await setProjectStatus(ctx.user._id, ctx.folder, body.status);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }
  return Response.json({ status: result.status });
}
