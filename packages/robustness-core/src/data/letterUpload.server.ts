/**
 * The upload door for a letter's pictures and its recording (Austin,
 * 2026-11-05: a client at the desk gets "writing, photos... recording
 * the letter on video"). The Vault's upload routes ask
 * `canActAsProjectOwner`, which in a Letters folder is a Guide alone
 * (`writesInFolder`), so a client could put nothing beside their own
 * letter. This widens nothing in the Vault: a request that names the
 * letter it is for (`letterFileId`) is let in when the person may write
 * that letter (`resolveLetterForWriter`), the folder is the letter's
 * own, and the file is a picture or a video. Not a markdown file: that
 * would be a letter planted in the folder, listed on every guide's desk
 * as theirs to send; bringing a letter in stays the manager's
 * (`api.projects.$folderId.letters.tsx`). Anyone else, any other folder
 * and any other kind of file is the Vault's rule as before.
 *
 * Who decides what. Code: the door. A person: what they put in the letter.
 */

import type { Human } from "./humans.server";
import { isMarkdownFileName, resolveLetterForWriter } from "./letters.server";
import { canActAsProjectOwner } from "./projectSharing.server";
import type { VaultFolder } from "./vault.types";

/** What a letter's writer may put beside it: a picture or a video, by
 * name and type together. The type is the browser's word and the name
 * is the file's: a `.md` sent as `image/png` is a letter (the store
 * files it by name), and a HEIC the browser gives no type for is a
 * picture. Never a markdown file. */
export function isLetterMedia(file: { name: string; type: string }): boolean {
  if (isMarkdownFileName(file.name)) return false;
  const byType = file.type.startsWith("image/") || file.type.startsWith("video/");
  const byName = /\.(jpe?g|png|gif|webp|heic|heif|avif|svg|mp4|webm|mov|m4v)$/i.test(file.name);
  return byType || byName;
}

export async function canUploadToFolder(
  user: Pick<Human, "_id" | "role">,
  folder: Pick<VaultFolder, "_id" | "human_id">,
  letter?: { letterFileId?: string | null; file: { name: string; type: string } },
): Promise<boolean> {
  if (await canActAsProjectOwner(user._id, folder.human_id, folder._id)) return true;
  if (!letter?.letterFileId || !isLetterMedia(letter.file)) return false;
  const mine = await resolveLetterForWriter(letter.letterFileId, user);
  return !!mine && mine.file.folder_id === folder._id;
}
