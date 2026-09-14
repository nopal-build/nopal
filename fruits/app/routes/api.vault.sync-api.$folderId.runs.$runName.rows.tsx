import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { appendSyncApiRows, resolveSyncApiAnalysis } from "robustness-core/data/syncApi.server";

/**
 * POST /api/vault/sync-api/:folderId/runs/:runName/rows — append rows to an
 * existing run's CSV. Body: `{ rows: [{ colA: ..., colB: ... }, ...] }`
 * (a single row may also be sent as `{ row: {...} }`). Always a
 * server-side read-append-write of the CSV — the caller only ever sends
 * the NEW rows, never the whole file. See the vault skill and
 * `syncApi.server.ts`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { folderId, runName } = params;
  if (!folderId || !runName) {
    return Response.json({ error: "folderId and runName required" }, { status: 400 });
  }

  const resolved = await resolveSyncApiAnalysis(folderId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status });

  if (!(await canActAsProjectOwner(scoped.user._id, resolved.folder.human_id, resolved.folder._id))) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    rows?: Record<string, unknown>[];
    row?: Record<string, unknown>;
  };
  const rows = body.rows ?? (body.row ? [body.row] : undefined);
  if (!rows || !Array.isArray(rows)) {
    return Response.json({ error: "rows (array) or row (object) required" }, { status: 400 });
  }

  const result = await appendSyncApiRows(resolved.folder, runName, rows);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ appended: result.appended });
}
