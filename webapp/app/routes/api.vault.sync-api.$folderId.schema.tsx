import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import {
  getSyncApiSchema,
  resolveSyncApiAnalysis,
  setSyncApiSchema,
  type SyncApiSchema,
} from "robustness-core/data/syncApi.server";

/**
 * GET/PUT /api/vault/sync-api/:folderId/schema — a `sync-api` analysis's
 * `_schema.json` (the typed CSV column definitions every run's CSV is
 * created against — see the vault skill and `syncApi.server.ts`). Bearer
 * auth supported (sync-scoped tokens included) — this is the CLI/hardware
 * entry point, same as `/api/sync-targets`.
 */

export async function loader({ request, params }: LoaderFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const resolved = await resolveSyncApiAnalysis(folderId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status });

  if (!(await canActAsProjectOwner(scoped.user._id, resolved.folder.human_id, resolved.folder._id))) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const schema = await getSyncApiSchema(resolved.folder);
  return Response.json({ schema: schema ?? null });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const resolved = await resolveSyncApiAnalysis(folderId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status });

  if (!(await canActAsProjectOwner(scoped.user._id, resolved.folder.human_id, resolved.folder._id))) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = (await request.json()) as { schema?: SyncApiSchema };
  if (!body.schema) {
    return Response.json({ error: "schema required" }, { status: 400 });
  }

  const result = await setSyncApiSchema(resolved.folder, body.schema);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ schema: result.schema });
}
