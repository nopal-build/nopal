import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import {
  getProjectRole,
  getProjectSharing,
  isProjectFolder,
  setProjectSharing,
  type ProjectSharingEntry,
} from "robustness-core/data/projectSharing.server";
import { getSharingRoles } from "robustness-core/data/sharingRoles.server";

/**
 * GET/PUT /api/vault/projects/:folderId/sharing — this app's own project
 * Sharing Roles. See `projectSharing.server.ts` for the underlying model:
 * the project's README.md front matter is the source of truth;
 * `vault_folders.shared_with` is a derived cache kept in sync by
 * `setProjectSharing`.
 */

async function loadContext(folderId: string, request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { error: Response.json({ error: "Not authenticated" }, { status: 401 }) };

  const folder = await getFolderById(folderId);
  if (!folder) return { error: Response.json({ error: "Not found" }, { status: 404 }) };

  const role = await getProjectRole(folder, user._id);
  if (!role) {
    // 404 (not 403) so a non-collaborator can't probe which project ids exist.
    return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  }

  if (!(await isProjectFolder(folder))) {
    return {
      error: Response.json(
        { error: "Sharing roles only apply to project folders" },
        { status: 400 },
      ),
    };
  }

  return { user, folder, role };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadContext(folderId, request);
  if ("error" in ctx) return ctx.error;

  const [sharing, roles] = await Promise.all([
    getProjectSharing(ctx.folder),
    getSharingRoles(),
  ]);

  return Response.json({
    sharing,
    roles: roles.map((r) => ({ name: r.name, is_owner: r.is_owner })),
    yourRole: ctx.role,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadContext(folderId, request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json()) as { sharing?: ProjectSharingEntry[] };
  if (!Array.isArray(body.sharing)) {
    return Response.json({ error: "sharing must be an array" }, { status: 400 });
  }
  const entries = body.sharing.filter(
    (e): e is ProjectSharingEntry =>
      !!e && typeof e.human === "string" && typeof e.role === "string",
  );

  const result = await setProjectSharing(ctx.user._id, ctx.folder, entries);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }
  return Response.json({ sharing: result.sharing });
}
