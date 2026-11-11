// app/routes/api.vault.camps.$campFolderId.log.entries.tsx
//
// GET /api/vault/camps/:campFolderId/log/entries — every entry in this
// camp's Log Book, oldest-first (callers reverse for newest-first UI).
// POST /api/vault/camps/:campFolderId/log/entries — creates the next
// sequential entry (body: `{ statement, entryDate? }`), provisioning the
// Log Book folder on first use.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, canViewFolderOrgAware } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { createLogEntry, getLogBookFolder, listLogEntries } from "robustness-core/data/camps.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const campFolderId = params.campFolderId;
  if (!campFolderId) return Response.json({ error: "Camp not found" }, { status: 404 });

  const campFolder = await getFolderById(campFolderId);
  if (!campFolder) return Response.json({ error: "Camp not found" }, { status: 404 });
  if (!(await canViewFolderOrgAware(user._id, campFolder))) {
    return Response.json({ error: "Camp not found" }, { status: 404 });
  }

  const logBookFolder = await getLogBookFolder(campFolder);
  if (!logBookFolder) return Response.json({ entries: [] });

  const entries = await listLogEntries(logBookFolder);
  return Response.json({ entries });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const campFolderId = params.campFolderId;
  if (!campFolderId) return Response.json({ error: "Camp not found" }, { status: 404 });

  const campFolder = await getFolderById(campFolderId);
  if (!campFolder) return Response.json({ error: "Camp not found" }, { status: 404 });
  if (!(await canActAsProjectOwner(user._id, campFolder.human_id, campFolder._id))) {
    return Response.json({ error: "Camp not found" }, { status: 404 });
  }

  const body = (await request.json()) as { statement?: string; entryDate?: string };
  if (!body.statement?.trim()) return Response.json({ error: "statement is required" }, { status: 400 });

  const folder = body.entryDate?.trim()
    ? await createLogEntry(campFolder, body.statement.trim(), body.entryDate.trim())
    : await createLogEntry(campFolder, body.statement.trim());
  return Response.json({ folder }, { status: 201 });
}
