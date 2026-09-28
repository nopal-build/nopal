import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { decideSuggestion } from "robustness-core/data/suggestions.server";

/**
 * POST /api/graphlog/suggestions
 *
 * A Guide takes or passes one suggestion (`suggestions.server.ts`):
 * { projectFolderId, kind: "card" | "note", id, verdict: "take" | "pass" }.
 * Only someone whose group gets `suggestions` on that project (a Guide);
 * anyone else gets the same 404 as a project that isn't there.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    kind?: string;
    id?: string;
    verdict?: string;
  };
  if (!body.projectFolderId || !body.id || (body.kind !== "card" && body.kind !== "note")) {
    return Response.json({ error: "Pick a suggestion first." }, { status: 400 });
  }
  if (body.verdict !== "take" && body.verdict !== "pass") {
    return Response.json({ error: "Take it or pass it." }, { status: 400 });
  }
  const project = await getFolderById(body.projectFolderId);
  if (!project || !(await getProjectRole(project, user._id))?.features.includes("suggestions")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const result = await decideSuggestion({
    project,
    kind: body.kind,
    id: body.id,
    verdict: body.verdict,
    guideHumanId: user._id,
  });
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: 409 });
}
