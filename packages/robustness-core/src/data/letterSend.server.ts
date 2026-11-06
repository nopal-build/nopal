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
 * Sending is also what puts the talk-through on the record (Austin,
 * 2026-11-05: "Once you send the letter, that is kind of the
 * distinction, that this is something that matters"): what the writer
 * said before writing waits on the letter's row until now, then goes
 * onto its speaker's Card for the send day (`landTalkThrough`).
 *
 * Who decides what. A person: writing, sending, sending again, which
 * house a guide's letter goes to, the link. Code: the copy and its hash,
 * the day, who it is from and its houses, the flags, the projection, the
 * talk-through's Card, the PDF's key. The model: nothing here.
 */

import { merge } from "./generic.server";
import { markDate } from "./graphLogMarks.server";
import { raiseLetterFlags } from "./letterFlags.server";
import { flagRecipients, houseAtSend, housesOf, mayWriteLetter, sendAsksForHouse, type House } from "./letterHouses";
import { houseMembers, houseOfActor } from "./letterHouses.server";
import { enqueueLetterPdfIfSent } from "./letterPdf.server";
import { syncLettersProjection } from "./letterSync.server";
import { landTalkThrough } from "./outline.server";
import { contentFingerprint, isMarkdownFileName, letterEditedSinceSent, letterHome, letterSendRefusal, letterViewerOf, sentCopyOf, type LetterRefusal } from "./letters.server";
import { getProjectRole } from "./projectSharing.server";
import type { Human } from "./humans.server";
import type { FileRef } from "./vault.types";

export type SendLetterResult = { ok: true; sentAt: string; count: number; toHouse: House } | ({ ok: false } & LetterRefusal);

/** The only writer of a letter's sent fields and its two houses, and of
 * who a guide's letter is from (a client's draft says who it is from
 * from the start, written by the route that starts it; Send keeps it).
 * `merge`, never `updateFileRef`: the draft's `updated_at` stays, so the
 * editor keyed on it doesn't remount and the tab doesn't reorder.
 *
 * Who may send is who may write the letter (`mayWriteLetter`): a Guide
 * on the project for the guides' letters, a client for their own, and a
 * client's letter is sent again only by that client (Austin,
 * 2026-11-05).
 *
 * The house (Austin, 2026-11-05; `houseAtSend` has the order): a letter
 * that has one keeps it; a draft goes where it was addressed when it was
 * started (the New letter form; a client's is always the team); only a
 * draft with no address (an upload, or one from before the form asked)
 * has the guide say which at Send (`toHouse`), with no default. The
 * first send that has a house writes `from_human_id`, `from_house` and
 * `to_house`, and no later send touches them: a send again by someone
 * else leaves the letter from whoever first sent it. A letter sent
 * before houses is asked like any other the next time it is sent, and
 * is from whoever last sent it.
 *
 * Then the flags (`letterFlags.server.ts`): up for everyone in the
 * receiving house now, except whoever is sending and whoever it is from.
 * Every send raises them, so a send again tells its readers. */
export async function sendLetter(actor: Pick<Human, "_id" | "role">, file: FileRef, input: { date?: string; toHouse?: unknown } = {}): Promise<SendLetterResult> {
  const home = await letterHome(file);
  const role = home ? await getProjectRole(home.project, actor._id) : null;
  const members = home ? await houseMembers(home.project) : [];
  const refusal = letterSendRefusal({ writes: mayWriteLetter(letterViewerOf(actor._id, role), file, members), inLetters: !!home, isMarkdown: isMarkdownFileName(file.name) });
  if (refusal || !home) return { ok: false, ...(refusal ?? { status: 400, error: "Only a file in the project's Letters folder can be sent" }) };

  // Whoever may send is a Guide on the project (the guides' house) or a
  // client (theirs).
  const senderHouse = houseOfActor(actor, role) ?? "guides";
  const decided = houseAtSend({ current: file, senderHouse, projectHasClients: members.some((m) => m.house === "clients"), asked: input.toHouse });
  if (!decided.ok) return decided;
  const kept = housesOf(file);
  const fromHumanId = kept?.fromHumanId ?? file.from_human_id ?? file.sent_by_human_id ?? actor._id;

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
    // Once: a letter that has its houses is sent again without them.
    ...(kept ? {} : { from_human_id: fromHumanId, from_house: senderHouse, to_house: decided.toHouse }),
  };
  await merge("file_refs", file._id, sent);
  const after: FileRef = { ...file, ...sent };
  await raiseLetterFlags({
    letterFileId: file._id,
    projectFolderId: home.project._id,
    humanIds: flagRecipients(members, decided.toHouse, [actor._id, fromHumanId]),
    at: sentAt,
  });
  await syncLettersProjection(home.project);
  // What was said toward this letter goes on the record with it, as its
  // speaker's words, once. The letter is sent whatever happens here: a
  // talk that could not land is still waiting and lands at the next send.
  try {
    await landTalkThrough(home.project, file._id, sent.sent_date);
  } catch (err) {
    console.error(`[letters] the talk-through for letter ${file._id} did not go on the record at Send:`, err);
  }
  // The PDF is of the sent copy, made when the link is on and after each
  // send while it is (`letterPdf.server.ts`).
  await enqueueLetterPdfIfSent(after);
  return { ok: true, sentAt, count: sent.sent_count, toHouse: decided.toHouse };
}

/** What the send control on a letter's page is given (`LetterSendControl`):
 * the three send states, and where the letter goes. `toHouse` is set
 * when that is already decided (the letter has a house, its draft was
 * addressed when it was started, or the project has no clients);
 * `asksHouse` when the guide has to say. Read in the page's loader: the component can't import
 * this module. */
export async function letterSendStateFor(file: FileRef): Promise<{ sentDate: string | null; sentCount: number; editedSinceSent: boolean; toHouse: House | null; asksHouse: boolean }> {
  const home = await letterHome(file);
  const members = home ? await houseMembers(home.project) : [];
  const projectHasClients = members.some((m) => m.house === "clients");
  const asksHouse = sendAsksForHouse({ current: file, projectHasClients });
  const decided = asksHouse ? null : houseAtSend({ current: file, senderHouse: "guides", projectHasClients });
  return {
    sentDate: sentCopyOf(file)?.date ?? null,
    sentCount: sentCopyOf(file)?.count ?? 0,
    editedSinceSent: letterEditedSinceSent(file),
    toHouse: decided?.ok ? decided.toHouse : null,
    asksHouse,
  };
}
