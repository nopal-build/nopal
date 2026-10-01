import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { inviteToProject } from "../data/projectInvites.server";

/**
 * POST /api/vault/projects/:folderId/invite — `{ email, name?, role }`.
 * Invites someone new onto this project in a role, or adds someone who
 * already has an account (ADR-023). Every rule is in `inviteToProject`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const folder = params.folderId ? await getFolderById(params.folderId) : undefined;
  if (!folder) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { email?: unknown; name?: unknown; role?: unknown } | null;
  if (!body || typeof body.email !== "string" || typeof body.role !== "string") {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await inviteToProject(
    user,
    { email: body.email, name: typeof body.name === "string" ? body.name : undefined, project: folder, role: body.role },
    request,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.error === "Not found" ? 404 : 403 });
  }
  return Response.json({
    human: { _id: result.human._id, name: result.human.name, email: result.human.email },
    created: result.created,
  });
}
