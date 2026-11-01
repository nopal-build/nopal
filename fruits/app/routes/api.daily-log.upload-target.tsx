import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  getOrCreateVaultFolder,
  resolveDailyLogsFolder,
} from "robustness-core/data/vault.server";

/**
 * POST /api/daily-log/upload-target
 * Body (JSON): { date }
 * Returns: { folderId }
 *
 * Resolves (get-or-creates) the vault folder a Daily Log attachment for
 * `date` belongs to -- the same folder `api.daily-log.upload.tsx` used to
 * resolve itself, split out so the CLIENT can get a `folderId` BEFORE any
 * file bytes exist, then upload straight to S3 via
 * `vaultUpload.ts`'s `uploadToVaultFolder` (same direct-to-S3/chunked-
 * multipart path the Vault's own uploader and the letter recording use)
 * instead of posting the whole file through this server.
 *
 * Why this split exists at all: the OLD whole-file route
 * (`api.daily-log.upload.tsx`) buffered a Daily Log attachment into
 * memory TWICE (once via `request.formData()`, again via
 * `file.arrayBuffer()` to hash it) with no size cap and no chunking --
 * a large video sent that way could and did OOM-kill the whole 1 GB
 * `nopal-fruits` machine mid-request, which the browser only ever saw as
 * a hung, response-less POST. `TodayLog.tsx`'s `uploadDailyLogFile` now
 * calls this route first, then `uploadToVaultFolder`, so file bytes never
 * fully land in this process's memory for anything but small files
 * (same <100 MB threshold `vaultUpload.ts` already uses elsewhere).
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { date?: string };
  const date = body.date ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid or missing date" }, { status: 400 });
  }

  const rootFolder = await resolveDailyLogsFolder(user._id);
  const dateFolder = await getOrCreateVaultFolder(user._id, date, rootFolder._id);

  return Response.json({ folderId: dateFolder._id });
}
