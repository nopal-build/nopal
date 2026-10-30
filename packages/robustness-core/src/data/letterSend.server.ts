/**
 * The send moment (Austin, 2026-10-27): a letter is a draft or sent. A
 * draft is read by guides only. Sending keeps a copy on the record
 * (`FileRef.sent_*`, `letters.server.ts`'s `sentCopyOf`), which is what
 * the client reads on their project page; the guide keeps working in the
 * draft and nothing reaches the client until they send again, which
 * replaces the copy and tells the client it was updated. Sending is also
 * when the letter's words enter the graph (`letterSync.server.ts`), and
 * when the PDF is remade if the public link is on. The link itself is a
 * second switch (`setLetterShared`), only on a sent letter.
 *
 * Who decides what. A person: writing, sending, sending again, the
 * link. Code: the copy and its hash, the day, the projection, the PDF's
 * key. The model: nothing here.
 */

import { merge } from "./generic.server";
import { markDate } from "./graphLogMarks.server";
import { enqueueLetterPdfIfSent } from "./letterPdf.server";
import { syncLettersProjection } from "./letterSync.server";
import { canManageLetters, contentFingerprint, isMarkdownFileName, letterHome, letterSendRefusal, sentCopyOf, type LetterRefusal } from "./letters.server";
import { getProjectRole } from "./projectSharing.server";
import type { Human } from "./humans.server";
import type { FileRef } from "./vault.types";

export type SendLetterResult = { ok: true; sentAt: string; count: number } | ({ ok: false } & LetterRefusal);

/** The only writer of a letter's sent fields. `merge`, never
 * `updateFileRef`: the draft's `updated_at` stays, so the editor keyed on
 * it doesn't remount and the tab doesn't reorder. */
export async function sendLetter(actor: Pick<Human, "_id" | "role">, file: FileRef, input: { date?: string } = {}): Promise<SendLetterResult> {
  const home = await letterHome(file);
  const role = home ? await getProjectRole(home.project, actor._id) : null;
  const refusal = letterSendRefusal({ manages: canManageLetters(actor, role), inLetters: !!home, isMarkdown: isMarkdownFileName(file.name) });
  if (refusal || !home) return { ok: false, ...(refusal ?? { status: 400, error: "Only a file in the project's Letters folder can be sent" }) };

  const before = sentCopyOf(file);
  // The instant, and apart from it the sender's day (the device's date,
  // clamped the way a mark's is): the projection's file and the client's
  // "Sent <date>" read the day, so no timezone shifts either.
  const sentAt = new Date().toISOString();
  const sent = {
    sent_content: file.content ?? "",
    sent_content_hash: contentFingerprint(file),
    sent_at: sentAt,
    sent_date: markDate(input.date),
    sent_by_human_id: actor._id,
    sent_count: (before?.count ?? 0) + 1,
  };
  await merge("file_refs", file._id, sent);
  const after: FileRef = { ...file, ...sent };
  await syncLettersProjection(home.project);
  // The PDF is of the sent copy, made when the link is on and after each
  // send while it is (`letterPdf.server.ts`).
  await enqueueLetterPdfIfSent(after);
  return { ok: true, sentAt, count: sent.sent_count };
}
