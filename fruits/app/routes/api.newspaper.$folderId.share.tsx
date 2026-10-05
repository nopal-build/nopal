import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { setNewspaperShared } from "robustness-core/data/newspaperShare.server";

/**
 * POST   /api/newspaper/:folderId/share   share the Efforts page by link
 * DELETE /api/newspaper/:folderId/share   stop sharing it
 *
 * Admin/Super only, no owner fallback (`setNewspaperShared`). Thin client:
 * the Share link control in the Newspaper header.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const folder = params.folderId ? await getFolderById(params.folderId) : null;
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });

  const result = await setNewspaperShared(user, folder, request.method === "POST");
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ sharedAt: result.sharedAt });
}
