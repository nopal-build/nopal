import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  createSyncScopedToken,
  revokeApiToken,
} from "robustness-core/data/apiTokens.server";

/**
 * POST   /api/sync-tokens          — mint a sync-scoped token
 *   Body: { name }  →  { token, tokenId }
 * DELETE /api/sync-tokens          — revoke one
 *   Body: { tokenId }
 *
 * Both require FULL auth (session or a normal login token) — a sync-scoped
 * token can never mint or revoke tokens. The minted token never expires;
 * revocation (here, or from the profile page) is the kill switch.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method === "POST") {
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim() || "Sync watcher";
    const minted = await createSyncScopedToken(user._id, `${name} (sync-scoped)`);
    if (!minted) {
      return Response.json({ error: "Failed to mint token" }, { status: 500 });
    }
    return Response.json(minted, { status: 201 });
  }

  if (request.method === "DELETE") {
    const body = (await request.json()) as { tokenId?: string };
    if (!body.tokenId) {
      return Response.json({ error: "tokenId required" }, { status: 400 });
    }
    const ok = await revokeApiToken(body.tokenId, user._id);
    if (!ok) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
