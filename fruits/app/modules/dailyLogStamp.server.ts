import { getFolderById, resolveDailyLogsFolder } from "robustness-core/data/vault.server";

/**
 * The daily log stamp (`source: "daily_log"`, `date`) an upload asks for,
 * if it is true. `isFileRefLocked` locks a daily log file once its day is
 * over, so a stamp the browser could set freely would let anyone lock any
 * file they can write by naming a past date. It is kept only when the
 * folder is this person's own Daily Logs folder for that very date, the
 * folder `api.daily-log.upload-target` hands out; anything else is filed
 * as a plain file. Used by `/api/vault/upload` and `multipart-complete`.
 */
export async function dailyLogStamp(
  humanId: string,
  folderId: string | null | undefined,
  source: unknown,
  date: unknown,
): Promise<{ source: "daily_log"; date: string } | null> {
  if (source !== "daily_log" || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !folderId) return null;
  const folder = await getFolderById(folderId);
  if (!folder || folder.human_id !== humanId || folder.name !== date) return null;
  const root = await resolveDailyLogsFolder(humanId);
  return folder.parent_folder_id === root._id ? { source: "daily_log", date } : null;
}
