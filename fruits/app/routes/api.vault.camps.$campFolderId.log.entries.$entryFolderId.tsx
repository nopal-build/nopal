// app/routes/api.vault.camps.$campFolderId.log.entries.$entryFolderId.tsx
//
// GET /api/vault/camps/:campFolderId/log/entries/:entryFolderId — one
// log entry's full detail (statement, dates, body, assets).
// PUT ...same path — update `statement`/`body` (bumps `editedDate`;
// `entryDate` is never changed after creation).
//
// `campFolderId` isn't used to look anything up here (the entry folder
// id alone is enough) — it's only present in the URL so the route
// mirrors the nesting of `api.vault.camps.$campFolderId.log.entries.tsx`.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, canViewFolderOrgAware } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { getLogEntry, updateLogEntry } from "robustness-core/data/camps.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const entryFolderId = params.entryFolderId;
  if (!entryFolderId) return Response.json({ error: "Entry not found" }, { status: 404 });

  const folder = await getFolderById(entryFolderId);
  if (!folder) return Response.json({ error: "Entry not found" }, { status: 404 });
  if (!(await canViewFolderOrgAware(user._id, folder))) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }

  const entry = await getLogEntry(entryFolderId);
  if (!entry) return Response.json({ error: "Entry not found" }, { status: 404 });
  return Response.json({ entry });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const entryFolderId = params.entryFolderId;
  if (!entryFolderId) return Response.json({ error: "Entry not found" }, { status: 404 });

  const folder = await getFolderById(entryFolderId);
  if (!folder) return Response.json({ error: "Entry not found" }, { status: 404 });
  if (!(await canActAsProjectOwner(user._id, folder.human_id, folder._id))) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }

  const body = (await request.json()) as { statement?: string; body?: string };
  const entry = await updateLogEntry(entryFolderId, { statement: body.statement, body: body.body });
  return Response.json({ entry });
}
