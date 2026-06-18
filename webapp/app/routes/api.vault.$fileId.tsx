import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  getFileRefById,
  updateFileRef,
  deleteFileRef,
  computeMdUpdate,
  getFolderById,
} from "../data/vault.server";
import { cacheDailyLog, deleteDailyLogCache } from "../data/dailyLog.server";
import { isFileRefLocked } from "../data/vault.types";

export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }
  const file = await getFileRefById(fileId);
  if (!file || !file.is_public) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ file });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
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
    };

    const updates: Parameters<typeof updateFileRef>[1] = {};

    if (body.name !== undefined) updates.name = body.name;
    if ("folder_id" in body) updates.folder_id = body.folder_id ?? null;
    if (body.is_public !== undefined) updates.is_public = body.is_public;
    if (body.shared_type !== undefined) updates.shared_type = body.shared_type;

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
