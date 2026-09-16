import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import {
  createSyncApiRun,
  listSyncApiRuns,
  resolveSyncApiAnalysis,
} from "robustness-core/data/syncApi.server";

/**
 * GET/POST /api/vault/sync-api/:folderId/runs — list or create runs inside a
 * `sync-api` analysis. A run is `<name>.md` + `<name>.csv`, created
 * together, snapshotting the analysis's current schema into the CSV's
 * header row. See the vault skill and `syncApi.server.ts`.
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

  const runs = await listSyncApiRuns(resolved.folder);
  return Response.json({ runs });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
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

  const body = (await request.json()) as {
    name?: string;
    prefix?: string;
    title?: string;
    body?: string;
  };

  const result = await createSyncApiRun(resolved.folder, {
    name: body.name,
    prefix: body.prefix,
    title: body.title,
    body: body.body,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ run: result.run }, { status: 201 });
}
