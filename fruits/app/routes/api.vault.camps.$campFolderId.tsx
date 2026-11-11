// app/routes/api.vault.camps.$campFolderId.tsx
//
// GET /api/vault/camps/:campFolderId — one camp's full detail
// (front matter + main body + observations, if any).
// PUT /api/vault/camps/:campFolderId — update statement/targetArrival/body
// (body: `{ statement?, targetArrival?, body? }`, all optional).
//
// See api.vault.camps.tsx for the shared auth pattern this mirrors.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, canViewFolderOrgAware } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { getCamp, setCamp } from "robustness-core/data/camps.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const campFolderId = params.campFolderId;
  if (!campFolderId) return Response.json({ error: "Camp not found" }, { status: 404 });

  const folder = await getFolderById(campFolderId);
  if (!folder) return Response.json({ error: "Camp not found" }, { status: 404 });
  if (!(await canViewFolderOrgAware(user._id, folder))) {
    return Response.json({ error: "Camp not found" }, { status: 404 });
  }

  const camp = await getCamp(campFolderId);
  if (!camp) return Response.json({ error: "Camp not found" }, { status: 404 });
  return Response.json({ camp });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const campFolderId = params.campFolderId;
  if (!campFolderId) return Response.json({ error: "Camp not found" }, { status: 404 });

  const folder = await getFolderById(campFolderId);
  if (!folder) return Response.json({ error: "Camp not found" }, { status: 404 });
  if (!(await canActAsProjectOwner(user._id, folder.human_id, folder._id))) {
    return Response.json({ error: "Camp not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    statement?: string;
    targetArrival?: string;
    body?: string;
  };

  const camp = await setCamp(campFolderId, {
    statement: body.statement,
    targetArrival: body.targetArrival,
    body: body.body,
  });
  return Response.json({ camp });
}
