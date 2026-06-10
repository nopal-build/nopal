import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  getFileRefById,
  updateFileRef,
  deleteFileRef,
  computeMdUpdate,
} from "../data/vault.server";
import { cacheDailyLog, deleteDailyLogCache } from "../data/dailyLog.server";
import { isFileRefLocked } from "../data/vault.types";

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
  if (file.human_id !== user._id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
    // Keep the daily_logs cache in sync
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
    };

    const updates: Parameters<typeof updateFileRef>[1] = {};

    if (body.name !== undefined) updates.name = body.name;
    if ("folder_id" in body) updates.folder_id = body.folder_id ?? null;

    if (body.content !== undefined) {
      const { content, md_versions } = computeMdUpdate(file, body.content);
      updates.content = content;
      updates.md_versions = md_versions;
    }

    const updated = await updateFileRef(fileId, updates);
    // Keep the daily_logs cache in sync when content changes
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
