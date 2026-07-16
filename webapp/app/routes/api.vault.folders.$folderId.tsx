import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  getFolderById,
  updateVaultFolder,
  cascadeShareVaultFolder,
  deleteVaultFolderCascade,
  resolveVaultRootKey,
} from "../data/vault.server";
import { isVaultRootFolder } from "../data/vault.types";
import { isRootShareable } from "../data/vaultRoots";

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { folderId } = params;
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  const folder = await getFolderById(folderId);
  if (!folder) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (folder.human_id !== user._id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const isRoot = isVaultRootFolder(folder);

  if (request.method === "DELETE") {
    if (isRoot) {
      return Response.json(
        { error: "Vault root folders cannot be deleted" },
        { status: 403 },
      );
    }
    await deleteVaultFolderCascade(folderId);
    return Response.json({ success: true });
  }

  if (request.method === "PATCH") {
    const body = (await request.json()) as {
      name?: string;
      shared_with?: string[] | "everyone";
    };

    if (isRoot && body.name !== undefined) {
      return Response.json(
        { error: "Vault root folders cannot be renamed" },
        { status: 403 },
      );
    }

    if (body.shared_with !== undefined) {
      // Sharing is a per-root policy (see vaultRoots.ts). The root container
      // itself is never shareable; nested folders only when the policy allows.
      const rootKey = isRoot
        ? null
        : (folder.vault_root_key ?? (await resolveVaultRootKey(folder._id)));
      if (!isRootShareable(rootKey)) {
        return Response.json(
          { error: "Folders in this part of the vault cannot be shared" },
          { status: 403 },
        );
      }
    }

    let updated;

    if (body.shared_with !== undefined) {
      // Apply any non-sharing changes (e.g. rename) first, then cascade the
      // new sharing setting to this folder AND all of its descendants.
      if (body.name !== undefined) {
        await updateVaultFolder(folderId, { name: body.name });
      }
      updated = await cascadeShareVaultFolder(folderId, body.shared_with);
    } else {
      // Name-only (or other non-sharing) update — no cascade needed.
      const updates: Parameters<typeof updateVaultFolder>[1] = {};
      if (body.name !== undefined) updates.name = body.name;
      updated = await updateVaultFolder(folderId, updates);
    }

    return Response.json({ folder: updated });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
