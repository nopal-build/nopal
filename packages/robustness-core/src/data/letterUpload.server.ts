/**
 * The upload door for a letter's pictures and its recording (Austin,
 * 2026-11-05: a client at the desk gets "writing, photos... recording
 * the letter on video"). The Vault's upload routes ask
 * `canActAsProjectOwner`, which in a Letters folder is a Guide alone
 * (`writesInFolder`), so a client could put nothing beside their own
 * letter. This widens nothing in the Vault: a request that names the
 * letter it is for (`letterFileId`) is let in when the person may write
 * that letter (`resolveLetterForWriter`) and the folder is the letter's
 * own. Anyone else, and any other folder, is the Vault's rule as before.
 *
 * Who decides what. Code: the door. A person: what they put in the letter.
 */

import type { Human } from "./humans.server";
import { resolveLetterForWriter } from "./letters.server";
import { canActAsProjectOwner } from "./projectSharing.server";
import type { VaultFolder } from "./vault.types";

export async function canUploadToFolder(
  user: Pick<Human, "_id" | "role">,
  folder: Pick<VaultFolder, "_id" | "human_id">,
  letterFileId?: string | null,
): Promise<boolean> {
  if (await canActAsProjectOwner(user._id, folder.human_id, folder._id)) return true;
  if (!letterFileId) return false;
  const mine = await resolveLetterForWriter(letterFileId, user);
  return !!mine && mine.file.folder_id === folder._id;
}
