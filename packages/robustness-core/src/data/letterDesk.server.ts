/**
 * The desk, where a letter is written inside its project (Austin,
 * 2026-11-06: "The whole letters workflow shouldn't go to the vault, it
 * should feel like you are still in the project, at the desk and writing
 * a letter"). This is the one place that says who the writing page opens
 * for; the page (`newspaper.$folderId_.letter.$fileId.tsx`) and the
 * draft's delete both ask it and nothing else.
 *
 * Who: both of
 * - someone who may write the letter (`resolveLetterForWriter`, the one
 *   rule: a Guide on the project for any letter but a client's, a client
 *   for a letter from them; a markdown letter, not archived, its project
 *   not trashed). Staff who are not on the project get the same 404 the
 *   project's own page gives them (Austin, 2026-11-06: they join the
 *   project to write there);
 * - the letter is in the project the address names, so one project's
 *   address never opens another's letter.
 *
 * The page exists only for someone who can write the letter, and there
 * is no read-only version of it to draw. The same rule stands behind
 * every door the page uses: the letter's own save
 * (`api.letter.$fileId.tsx`), the talk, outline, workings read,
 * dictation, recording and send routes (`letterForWriter`), the uploads
 * into the letter's folder (`canUploadToFolder`), and the letter's file
 * routes for a draft's pictures (`letterDraftFile`). A
 * draft's words, its talk-through and its outline leave the server
 * through `letterWritingFor` only after the rule.
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
import { resolveLetterForWriter, sentCopyOf, type LetterWriterKind } from "./letters.server";
import { deleteFileRef } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";

/** The letter, when this person may write it at its project's desk.
 * `project` is the project an address names, and the letter has to be in
 * it; a caller with no address (the delete, by the letter's own id)
 * passes null and the letter's own project is the one asked about. */
export async function resolveLetterAtDesk(project: Pick<VaultFolder, "_id"> | null, fileId: string | undefined, user: Pick<Human, "_id" | "role">): Promise<{ file: FileRef; writer: LetterWriterKind } | null> {
  const mine = fileId ? await resolveLetterForWriter(fileId, user) : null;
  if (!mine || (project && mine.project._id !== project._id)) return null;
  return { file: mine.file, writer: mine.writer };
}

/** The page's data. `writer` says whose letter it is: a client's page
 * has no brief (Austin, 2026-11-05: a client "does not get the brief"),
 * and nothing else differs. */
export type LetterWritingPage = { file: FileRef; writer: LetterWriterKind; brief: LetterBriefForPage; send: Awaited<ReturnType<typeof letterSendStateFor>> };

/** What the writing page is handed, or null for anyone `resolveLetterAtDesk`
 * refuses. */
export async function letterWritingFor(project: Pick<VaultFolder, "_id">, fileId: string | undefined, user: Pick<Human, "_id" | "role">): Promise<LetterWritingPage | null> {
  const mine = await resolveLetterAtDesk(project, fileId, user);
  if (!mine) return null;
  return { file: mine.file, writer: mine.writer, brief: await getLetterBriefForPage(mine.file._id), send: await letterSendStateFor(mine.file) };
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
  const mine = await resolveLetterAtDesk(null, fileId, user);
  if (!mine) return { ok: false, status: 404, error: "Not found" };
  if (letterHasGoneOut(mine.file)) return { ok: false, status: 400, error: LETTER_SENT_STAYS };
  await deleteFileRef(mine.file._id);
  await removeLetterBriefRow(mine.file._id);
  return { ok: true };
}

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const LETTER_SENT_STAYS = "This letter was sent, so it stays. Only a draft can be deleted here.";
