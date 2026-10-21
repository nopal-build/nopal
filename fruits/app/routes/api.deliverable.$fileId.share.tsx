import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { deliverablePublicPath, setDeliverableShared } from "robustness-core/data/deliverables.server";

/**
 * POST   /api/deliverable/:fileId/share   turn the deliverable's link on
 * DELETE /api/deliverable/:fileId/share   turn it off
 *
 * A Guide on the project or staff (`setDeliverableShared`). Thin client:
 * the share control on the project's Deliverables tab.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const file = params.fileId ? await getFileRefById(params.fileId) : null;
  if (!file) return Response.json({ error: "Deliverable not found" }, { status: 404 });

  const result = await setDeliverableShared(user, file, request.method === "POST");
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ sharedAt: result.sharedAt, path: deliverablePublicPath(file._id) });
}
