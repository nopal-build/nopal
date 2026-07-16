import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getScopedUserFromRequest,
  getUserFromRequest,
} from "../modules/auth/auth.server";
import {
  createSyncTarget,
  getSyncTargetsByHuman,
} from "../data/syncTargets.server";
import { getFolderById, resolveVaultRootKey } from "../data/vault.server";

/**
 * GET  /api/sync-targets          — list this human's sync targets
 * POST /api/sync-targets          — register a new target
 *   Body: { name, folderId, deviceId, deviceLabel, localPath }
 *
 * The folder must live under the human's `syncs/` root. Bearer-token auth
 * supported (this API exists for the CLI).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Listing targets is inherently sync-scope — the watcher needs it.
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const targets = await getSyncTargetsByHuman(scoped.user._id);
  return Response.json({ targets });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    name?: string;
    folderId?: string;
    deviceId?: string;
    deviceLabel?: string;
    localPath?: string;
    preprocess?: boolean;
    twoWay?: boolean;
  };
  const { name, folderId, deviceId, deviceLabel, localPath, preprocess, twoWay } =
    body;
  if (!name || !folderId || !deviceId || !localPath) {
    return Response.json(
      { error: "name, folderId, deviceId, and localPath are required" },
      { status: 400 },
    );
  }

  const folder = await getFolderById(folderId);
  if (!folder || folder.human_id !== user._id) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  const rootKey =
    folder.vault_root_key ?? (await resolveVaultRootKey(folder._id));
  if (rootKey !== "syncs") {
    return Response.json(
      { error: "Sync targets must point at a folder inside syncs/" },
      { status: 400 },
    );
  }

  // One target per folder — a second device syncs into its own folder.
  const existing = await getSyncTargetsByHuman(user._id);
  if (existing.some((t) => t.folderId === folderId)) {
    return Response.json(
      { error: "That folder already has a sync target" },
      { status: 409 },
    );
  }

  const target = await createSyncTarget({
    humanId: user._id,
    name,
    folderId,
    deviceId,
    deviceLabel: deviceLabel ?? "unknown-device",
    localPath,
    preprocess: preprocess === true,
    twoWay: twoWay === true,
  });
  return Response.json({ target }, { status: 201 });
}
