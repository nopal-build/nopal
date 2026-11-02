import type { ScopedUser } from "./auth/auth.server";
import {
  canWriteToFolderId,
  explainWriteRefusal,
  getFolderById,
  isFolderUnderSyncs,
  resolveDailyLogsFolder,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner, getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { currentSeedRound } from "robustness-core/data/seedPackets.server";

/**
 * Where an upload is going, as the browser names it. The bytes go straight
 * to storage (`vaultUpload.ts`), so the server never sees the file; what it
 * still owns is deciding, at `multipart-init` and again at
 * `multipart-complete`, whether this person may put a file there, and what
 * record the finished upload becomes.
 *
 * - `folder`: a Vault folder (or the root, `null`). A file_ref in it. A
 *   daily log attachment is this too: the day's folder comes from
 *   `api.daily-log.upload-target`, and the stamp is checked by
 *   `dailyLogStamp` below.
 * - `seedPacket`: the person's packet on a project, during an open round.
 *   A packet row (`addPacketFile`), not a file_ref.
 */
export type UploadTarget =
  | { kind: "folder"; folderId: string | null }
  | { kind: "seedPacket"; projectFolderId: string };

export type ResolvedUploadTarget =
  | { kind: "folder"; folderId: string | null; ownerId: string; keySegment: string }
  | { kind: "seedPacket"; projectFolderId: string; round: number; keySegment: string };

/** Reads the target from a JSON body. Older callers (the CLI, a tab still
 * running older code) send only `folderId`. */
export function uploadTargetFromBody(body: { folderId?: string | null; target?: unknown }): UploadTarget | null {
  const t = body.target as { kind?: unknown; projectFolderId?: unknown; folderId?: unknown } | undefined;
  if (!t) return { kind: "folder", folderId: body.folderId ?? null };
  if (t.kind === "seedPacket" && typeof t.projectFolderId === "string") return { kind: "seedPacket", projectFolderId: t.projectFolderId };
  if (t.kind === "folder") return { kind: "folder", folderId: typeof t.folderId === "string" ? t.folderId : null };
  return null;
}

/** The checks for one target, or the refusal to send back. Run at both ends
 * of an upload: the key prefix only proves the bytes are this person's, not
 * that the place they're being filed is theirs to write. */
export async function resolveUploadTarget(
  scoped: ScopedUser,
  target: UploadTarget,
): Promise<{ ok: true; target: ResolvedUploadTarget } | { ok: false; response: Response }> {
  const { user, syncScoped } = scoped;
  const refuse = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status }) });

  if (target.kind === "seedPacket") {
    if (syncScoped) return refuse("Forbidden", 403);
    // The same 404 for a project that doesn't exist and one this person
    // isn't on, so an id can't be probed (`api.seed-packet.tsx`).
    const folder = await getFolderById(target.projectFolderId);
    if (!folder || !(await isProjectFolder(folder)) || !(await getProjectRole(folder, user._id))) return refuse("Not found", 404);
    const round = await currentSeedRound(folder._id);
    if (!round) return refuse("This project isn't taking seed packets right now.", 409);
    return { ok: true, target: { kind: "seedPacket", projectFolderId: folder._id, round: round.round, keySegment: `seed-packets/${folder._id}` } };
  }

  const { folderId } = target;
  // Sync-scoped tokens may only write inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(folderId))) return refuse("Forbidden", 403);
  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the owning human's own vault; see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (!(await canWriteToFolderId(folderId, user.role))) return refuse(await explainWriteRefusal(folderId, user.role), 403);
  const folder = folderId ? await getFolderById(folderId) : null;
  if (folderId && !folder) return refuse("Folder not found", 404);
  // An owner-tier project Sharing Role (Owner/Crafter) may upload into
  // someone else's shared project exactly like its own owner could; see
  // `canActAsProjectOwner`. The file is filed under the folder's owner.
  if (folder && !(await canActAsProjectOwner(user._id, folder.human_id, folderId))) {
    return refuse("You don't have permission to upload files here", 403);
  }
  return {
    ok: true,
    target: { kind: "folder", folderId, ownerId: folder ? folder.human_id : user._id, keySegment: folderId ?? "root" },
  };
}

/**
 * The daily log stamp (`source: "daily_log"`, `date`) a caller asks for,
 * if it is true. `isFileRefLocked` locks a daily log file once its day is
 * over, so a stamp the browser could set freely would let anyone lock any
 * file they can write by naming a past date. It is kept only when the
 * folder is this person's own Daily Logs folder for that very date, the
 * folder `api.daily-log.upload-target` hands out; anything else is filed
 * as a plain file.
 */
export async function dailyLogStamp(
  humanId: string,
  folderId: string | null,
  source: unknown,
  date: unknown,
): Promise<{ source: "daily_log"; date: string } | null> {
  if (source !== "daily_log" || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !folderId) return null;
  const folder = await getFolderById(folderId);
  if (!folder || folder.human_id !== humanId || folder.name !== date) return null;
  const root = await resolveDailyLogsFolder(humanId);
  return folder.parent_folder_id === root._id ? { source: "daily_log", date } : null;
}
