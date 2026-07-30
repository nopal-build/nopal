import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getScopedUserFromRequest,
  getUserFromRequest,
} from "../modules/auth/auth.server";
import {
  canWriteToFolderId,
  getFileRefById,
  updateFileRef,
  deleteFileRef,
  computeMdUpdate,
  getFolderById,
  isFolderIdShareable,
  isFolderUnderSyncs,
} from "../data/vault.server";
import { cacheDailyLog, deleteDailyLogCache } from "../data/dailyLog.server";
import { isFileRefLocked } from "../data/vault.types";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }
  const file = await getFileRefById(fileId);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Public cards are readable by anyone; otherwise only the owner — via
  // session OR bearer token (the CLI's read path for `vault cat` / `info`,
  // and the sync engine's inline-content pulls). Sync-scoped tokens can
  // only read files under syncs/.
  if (!file.is_public) {
    const scoped = await getScopedUserFromRequest(request);
    if (!scoped || file.human_id !== scoped.user._id) {
      // 404 (not 403) so non-owners can't probe which ids exist.
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (scoped.syncScoped && !(await isFolderUnderSyncs(file.folder_id))) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  return Response.json({ file });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Sync-scoped tokens: owner-only, syncs/-only, and PATCH may touch
  // nothing but archived_at (how the sync engine propagates local
  // deletions). Everything else — rename, move, content, sharing,
  // DELETE — requires full auth.
  if (syncScoped) {
    if (
      file.human_id !== user._id ||
      !(await isFolderUnderSyncs(file.folder_id)) ||
      request.method !== "PATCH"
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "archived_at") {
      return Response.json(
        { error: "Sync tokens may only set archived_at" },
        { status: 403 },
      );
    }
    const updated = await updateFileRef(fileId, {
      archived_at: (body.archived_at as string | null) ?? null,
    });
    return Response.json({ fileRef: updated });
  }

  const isOwner = file.human_id === user._id;

  // Non-owners: only a content-only PATCH is allowed, and only when the file's
  // shared_type permits writing (workable or editable) and the file lives in a
  // folder that is shared with this user.
  if (!isOwner) {
    if (request.method !== "PATCH") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const sharedType = file.shared_type ?? "view";
    if (sharedType !== "workable" && sharedType !== "editable") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!file.folder_id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const folder = await getFolderById(file.folder_id);
    const isShared =
      folder &&
      (folder.shared_with === "everyone" ||
        (Array.isArray(folder.shared_with) &&
          folder.shared_with.includes(user._id)));

    if (!isShared) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Allow only a content update.
    const body = (await request.json()) as { content?: string };
    if (body.content === undefined) {
      return Response.json(
        { error: "Only content updates are allowed" },
        { status: 400 },
      );
    }

    const { content, md_versions } = computeMdUpdate(file, body.content);
    const updated = await updateFileRef(fileId, { content, md_versions });
    return Response.json({ fileRef: updated });
  }

  // Owner-only operations below.

  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (request.method === "DELETE" || request.method === "PATCH") {
    if (!(await canWriteToFolderId(file.folder_id, user.role))) {
      return Response.json(
        { error: "You don't have permission to modify this file" },
        { status: 403 },
      );
    }
  }

  if (
    isFileRefLocked(file) &&
    (request.method === "DELETE" || request.method === "PATCH")
  ) {
    return Response.json(
      {
        error:
          "This file is locked — daily-log files can only be modified on the day they were uploaded.",
      },
      { status: 403 },
    );
  }

  if (request.method === "DELETE") {
    await deleteFileRef(fileId);
    if (file.source === "daily_log" && file.date) {
      await deleteDailyLogCache(file.human_id, file.date);
    }
    return Response.json({ success: true });
  }

  if (request.method === "PATCH") {
    const body = (await request.json()) as {
      name?: string;
      folder_id?: string | null;
      content?: string;
      is_public?: boolean;
      shared_type?: "view" | "workable" | "editable";
      archived_at?: string | null;
    };

    // Making a file public (or granting shared write access) follows the same
    // per-root AND per-folder-type policy as folder sharing — e.g. daily-
    // logs/personal files can never be shared, even directly, and neither
    // can files inside a `skills` folder.
    if (body.is_public === true || body.shared_type !== undefined) {
      if (!(await isFolderIdShareable(file.folder_id))) {
        return Response.json(
          { error: "Files in this part of the vault cannot be shared" },
          { status: 403 },
        );
      }
    }

    const updates: Parameters<typeof updateFileRef>[1] = {};

    // Moving a file INTO a restricted root or folder type (e.g. `skills`)
    // needs the same role as creating one directly inside it would.
    if ("folder_id" in body && body.folder_id) {
      if (!(await canWriteToFolderId(body.folder_id, user.role))) {
        return Response.json(
          { error: "You don't have permission to move files here" },
          { status: 403 },
        );
      }
    }

    if (body.name !== undefined) updates.name = body.name;
    if ("folder_id" in body) updates.folder_id = body.folder_id ?? null;
    if (body.is_public !== undefined) updates.is_public = body.is_public;
    if (body.shared_type !== undefined) updates.shared_type = body.shared_type;
    if ("archived_at" in body) updates.archived_at = body.archived_at ?? null;

    if (body.content !== undefined) {
      const { content, md_versions } = computeMdUpdate(file, body.content);
      updates.content = content;
      updates.md_versions = md_versions;
    }

    const updated = await updateFileRef(fileId, updates);
    if (
      file.source === "daily_log" &&
      file.date &&
      body.content !== undefined
    ) {
      await cacheDailyLog(
        file.human_id,
        file.date,
        updates.content ?? body.content,
      );
    }
    return Response.json({ fileRef: updated });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
