import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  getFolderById,
  updateVaultFolder,
  cascadeShareVaultFolder,
  deleteVaultFolderCascade,
  resolveVaultRootKey,
  getDescendantFolders,
  getFileRefsByFolderIds,
  isFolderShared,
  moveVaultFolder,
} from "../data/vault.server";
import { isFileRefLocked, isVaultRootFolder } from "../data/vault.types";
import { isRootPublishable, isRootShareable } from "../data/vaultRoots";

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

    // The daily-log lock (past logs are read-only) applies to cascade deletes
    // too — otherwise deleting a date folder would sidestep the single-file
    // DELETE guard in api.vault.$fileId.
    const descendants = await getDescendantFolders(folderId);
    const files = await getFileRefsByFolderIds([
      folderId,
      ...descendants.map((d) => d._id),
    ]);
    if (files.some(isFileRefLocked)) {
      return Response.json(
        {
          error:
            "This folder contains locked daily-log files and cannot be deleted.",
        },
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
      /** Move the folder under this parent. Never null — the vault root only
       * holds the locked root containers. */
      parent_folder_id?: string;
      /** Publish/unpublish — this folder and everything inside it become
       * reachable at a public, unauthenticated URL. */
      is_public?: boolean;
    };

    if (isRoot && body.name !== undefined) {
      return Response.json(
        { error: "Vault root folders cannot be renamed" },
        { status: 403 },
      );
    }

    // ── Move ── handled on its own; not combinable with rename/share.
    if (body.parent_folder_id !== undefined) {
      if (isRoot) {
        return Response.json(
          { error: "Vault root folders cannot be moved" },
          { status: 403 },
        );
      }
      if (isFolderShared(folder)) {
        return Response.json(
          { error: "Shared folders cannot be moved — unshare it first" },
          { status: 403 },
        );
      }

      const newParent = await getFolderById(body.parent_folder_id);
      if (!newParent || newParent.human_id !== user._id) {
        return Response.json(
          { error: "Destination folder not found" },
          { status: 404 },
        );
      }
      if (newParent._id === folder._id) {
        return Response.json(
          { error: "Cannot move a folder into itself" },
          { status: 400 },
        );
      }
      if (newParent._id === folder.parent_folder_id) {
        // No-op move — already there.
        return Response.json({ folder });
      }

      const descendants = await getDescendantFolders(folder._id);
      if (descendants.some((d) => d._id === newParent._id)) {
        return Response.json(
          { error: "Cannot move a folder into one of its own sub-folders" },
          { status: 400 },
        );
      }
      if (descendants.some(isFolderShared)) {
        return Response.json(
          {
            error:
              "This folder contains shared folders and cannot be moved — unshare them first",
          },
          { status: 403 },
        );
      }

      const moved = await moveVaultFolder(folder, newParent, descendants);
      return Response.json({ folder: moved });
    }

    // ── Publish ── handled on its own; not combinable with rename/share/move.
    if (body.is_public !== undefined) {
      if (isRoot) {
        return Response.json(
          { error: "Vault root folders cannot be published" },
          { status: 403 },
        );
      }
      const rootKey =
        folder.vault_root_key ?? (await resolveVaultRootKey(folder._id));
      if (!isRootPublishable(rootKey)) {
        return Response.json(
          { error: "Folders in this part of the vault cannot be published" },
          { status: 403 },
        );
      }
      const updated = await updateVaultFolder(folderId, {
        is_public: body.is_public,
      });
      return Response.json({ folder: updated });
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
