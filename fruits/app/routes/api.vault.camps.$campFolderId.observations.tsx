// app/routes/api.vault.camps.$campFolderId.observations.tsx
//
// POST /api/vault/camps/:campFolderId/observations — records (or
// replaces) a camp's `OBSERVATIONS.md`, the one and only thing that
// marks it complete (body: `{ statement, arrivalDate }`).
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { getCamp, recordCampObservations } from "robustness-core/data/camps.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const campFolderId = params.campFolderId;
  if (!campFolderId) return Response.json({ error: "Camp not found" }, { status: 404 });

  const folder = await getFolderById(campFolderId);
  if (!folder) return Response.json({ error: "Camp not found" }, { status: 404 });
  if (!(await canActAsProjectOwner(user._id, folder.human_id, folder._id))) {
    return Response.json({ error: "Camp not found" }, { status: 404 });
  }

  const body = (await request.json()) as { statement?: string; arrivalDate?: string };
  if (!body.statement?.trim()) return Response.json({ error: "statement is required" }, { status: 400 });
  if (!body.arrivalDate?.trim()) return Response.json({ error: "arrivalDate is required" }, { status: 400 });

  await recordCampObservations(campFolderId, body.statement.trim(), body.arrivalDate.trim());
  const camp = await getCamp(campFolderId);
  return Response.json({ camp });
}
