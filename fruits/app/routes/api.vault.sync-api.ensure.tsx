import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { ensureSyncApiAnalysis, type SyncApiSchema } from "robustness-core/data/syncApi.server";

/**
 * POST /api/vault/sync-api/ensure — resolves (creating if missing) a
 * `sync-api` analysis folder and returns its id, in one call. Body:
 * `{ project?, name, schema }` (`project` is a plain project NAME, not a
 * vault path — see `ensureSyncApiAnalysis`'s own doc for why). Exists for
 * CONSTRAINED clients (an embedded device) that hold a sync-scoped token
 * and so can't walk the vault tree themselves the way the CLI does — see
 * the vault skill and `syncApi.server.ts`.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as {
    project?: string | null;
    name?: string;
    schema?: SyncApiSchema;
  };
  if (!body.name || !body.schema) {
    return Response.json({ error: "name and schema are required" }, { status: 400 });
  }

  const result = await ensureSyncApiAnalysis(
    scoped.user._id,
    body.project,
    body.name,
    body.schema,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ folder: result.folder });
}
