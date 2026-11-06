/**
 * The desk, where a letter is written inside its project (Austin,
 * 2026-11-06: "The whole letters workflow shouldn't go to the vault, it
 * should feel like you are still in the project, at the desk and writing
 * a letter"). This is the one place that says who the writing page opens
 * for; the page (`newspaper.$folderId_.letter.$fileId.tsx`) and the
 * draft's delete both ask it and nothing else.
 *
 * Who: all of
 * - someone who manages letters on the letter's project
 *   (`resolveLetterForManager`: a Guide there, or staff; a markdown
 *   letter, not archived, its project not trashed);
 * - the letter is in the project the address names, so one project's
 *   address never opens another's letter;
 * - the save route would take their save (`api.vault.$fileId.tsx` asks
 *   exactly this: the file's owner, or `canActAsProjectOwner`). So the
 *   page exists only for someone who can write the letter, and there is
 *   no read-only version of it to draw. Staff who are not on the project
 *   pass the first test and fail this one: they get the same 404 the
 *   project's own page gives them.
 *
 * A draft's words, its talk-through and its outline leave the server
 * through `letterWritingFor` only after all three. Clients writing
 * (their own round) opens this door and no other.
 *
 * Deleting is for a draft (Austin, 2026-11-06): a letter that was sent
 * is in someone's mailbox and stays. A draft goes with its workings,
 * since what was said toward it never reached the record ("you could
 * talk it through and then decide that it's not important").
 *
 * Who decides what. A person: writing, deleting a draft. Code: the gate.
 */

import { getLetterBriefForPage, removeLetterBriefRow, type LetterBriefForPage } from "./brief.server";
import type { Human } from "./humans.server";
import { letterSendStateFor } from "./letterSend.server";
import { resolveLetterForManager, sentCopyOf } from "./letters.server";
import { canActAsProjectOwner } from "./projectSharing.server";
import { deleteFileRef } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";

/** The letter, when this person may write it at its project's desk.
 * `project` is the project an address names, and the letter has to be in
 * it; a caller with no address (the delete, by the letter's own id)
 * passes null and the letter's own project is the one asked about. */
export async function letterWriter(project: Pick<VaultFolder, "_id"> | null, fileId: string | undefined, user: Pick<Human, "_id" | "role">): Promise<FileRef | null> {
  const mine = fileId ? await resolveLetterForManager(fileId, user) : null;
  if (!mine || (project && mine.project._id !== project._id)) return null;
  const saves = mine.file.human_id === user._id || (await canActAsProjectOwner(user._id, mine.file.human_id, mine.file.folder_id));
  return saves ? mine.file : null;
}

export type LetterWritingPage = { file: FileRef; brief: LetterBriefForPage; send: Awaited<ReturnType<typeof letterSendStateFor>> };

/** What the writing page is handed, or null for anyone `letterWriter`
 * refuses. */
export async function letterWritingFor(project: Pick<VaultFolder, "_id">, fileId: string | undefined, user: Pick<Human, "_id" | "role">): Promise<LetterWritingPage | null> {
  const file = await letterWriter(project, fileId, user);
  if (!file) return null;
  return { file, brief: await getLetterBriefForPage(file._id), send: await letterSendStateFor(file) };
}

/** Whether a letter has ever gone to anyone: sent, or its link turned on
 * (a link from before sends is a letter someone may hold). */
export function letterHasGoneOut(file: FileRef): boolean {
  return !!sentCopyOf(file) || !!file.shared_at;
}

export type RemoveDraftResult = { ok: true } | { ok: false; status: 400 | 404; error: string };

/** Deletes a draft and its workings. Refused, here and not by a hidden
 * button, for a letter that has gone out and for anyone who could not
 * write it. */
export async function removeDraftLetter(fileId: string | undefined, user: Pick<Human, "_id" | "role">): Promise<RemoveDraftResult> {
  const file = await letterWriter(null, fileId, user);
  if (!file) return { ok: false, status: 404, error: "Not found" };
  if (letterHasGoneOut(file)) return { ok: false, status: 400, error: LETTER_SENT_STAYS };
  await deleteFileRef(file._id);
  await removeLetterBriefRow(file._id);
  return { ok: true };
}

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const LETTER_SENT_STAYS = "This letter was sent, so it stays. Only a draft can be deleted here.";
