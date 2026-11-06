/**
 * Talking a letter through while reading it (Austin, 2026-11-06): "There
 * should be an option to talk through the letter while you are viewing
 * it. That would give thoughts from the user into graphlog in response
 * to a letter ... the idea of letters isn't to mark up someone elses'
 * letter but to think through the complete ideas." The `reply-pause`
 * seed's reflection, moved from a reply's page (Reply was cut) to the
 * letter being read. It is its own act: worth keeping whether or not a
 * letter follows.
 *
 * One row per (letter, person): what they have typed or said and not
 * kept, then what they kept. Keeping is the person's click, and it is
 * what puts their words on the project's record, on their own Card for
 * that day (`appendToCard`, the daily log's own rules: an Observer's is
 * a suggestion a guide takes or passes; a Client's and a Crafter's go
 * straight on). Until then it is a draft nobody else is shown. Once.
 *
 * Who is shown it: the person who said it, on the letter's page, and
 * nobody else there. Nothing lists rows by letter, and no page is given
 * anyone's but the viewer's own. That is this table and that page only:
 * a kept reflection is a Card, read wherever Cards are read.
 *
 * Its own table, for `letter_flags`' reason: the letter's record goes
 * whole to everyone in the guides' house through the Vault's routes.
 *
 * A kept reflection can start a letter (`reflectionToStartFrom`, asked
 * by the project page and by the route that creates the letter): an
 * ordinary new letter, started and addressed like any other, with the
 * reflection as its talk-through. Never a reply.
 *
 * Who decides what. A person: the words, keeping them, starting a
 * letter. Code: who may reflect (`mayReflect`), the Card, the one line
 * ahead of the words saying which letter was being read, the day.
 */

import { RecordId } from "surrealdb";
import { appendToCard } from "./dailyLog.server";
import { runDailyLogSync } from "./dailyLogSync.server";
import type { Feature } from "./features";
import { defineTable, formatRecord, merge, select, upsert, type Data } from "./generic.server";
import { markDate } from "./graphLogMarks.server";
import { firstName } from "./humanNames";
import { getHumanById } from "./humans.server";
import { housesOf } from "./letterHouses";
import { letterTitle, resolveSentLetterForMember } from "./letters.server";
import type { FileRef, VaultFolder } from "./vault.types";

const TABLE = "letter_reflections";
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

export type LetterReflectionRow = Data & {
  letter_file_id: string;
  project_folder_id: string;
  human_id: string;
  /** What they have typed or said and not kept. */
  draft?: string | null;
  /** Their words as kept. The line naming the letter is on the Card only. */
  text?: string | null;
  kept_at?: string | null;
  /** The day it went onto their Card, the device's date clamped by `markDate`. */
  kept_date?: string | null;
  card_file_id?: string | null;
  /** Held as a suggestion for a guide (someone without `feeds`). */
  suggestion?: boolean;
};

/** One id per (letter, person). */
export function letterReflectionId(letterFileId: string, humanId: string): string {
  return `${letterFileId}__${humanId}`;
}

/** This person's reflection on this letter. Only ever asked about the
 * viewer themself. */
export async function getReflection(letterFileId: string, humanId: string): Promise<LetterReflectionRow | null> {
  await ensureTable();
  const row = await select<LetterReflectionRow>(new RecordId(TABLE, letterReflectionId(letterFileId, humanId)));
  return row ? formatRecord(row) : null;
}

async function writeReflection(letterFileId: string, projectFolderId: string, humanId: string, patch: Partial<Omit<LetterReflectionRow, "_id">>): Promise<void> {
  const id = letterReflectionId(letterFileId, humanId);
  if (await getReflection(letterFileId, humanId)) await merge(TABLE, id, patch);
  else await upsert(new RecordId(TABLE, id), { letter_file_id: letterFileId, project_folder_id: projectFolderId, human_id: humanId, ...patch });
}

/** What the letter's page is given: the viewer's own reflection. */
export type ReflectionForPage = { draft: string | null; kept: { text: string; date: string; suggestion: boolean } | null };

export function reflectionForPage(row: LetterReflectionRow | null): ReflectionForPage {
  const kept = row?.text && row.kept_date ? { text: row.text, date: row.kept_date, suggestion: !!row.suggestion } : null;
  return { draft: kept ? null : (row?.draft ?? null), kept };
}

export type ReflectionResult = { ok: true; suggestion?: boolean } | { ok: false; status: 400 | 403 | 409 | 500; error: string };

/** Autosave of what they have said so far. Nothing once it is kept. */
export async function saveReflectionDraft(project: VaultFolder, letter: FileRef, humanId: string, draft: string): Promise<ReflectionResult> {
  const row = await getReflection(letter._id, humanId);
  if (row?.text) return { ok: false, status: 409, error: REFLECTION_KEPT_ALREADY };
  await writeReflection(letter._id, project._id, humanId, { draft });
  return { ok: true };
}

/** Who a letter is from, by first name: whoever its houses name, or
 * whoever sent a letter from before houses. Null when nobody can say. */
export async function letterSenderName(letter: FileRef): Promise<string | null> {
  const id = letterSenderId(letter);
  const sender = id ? await getHumanById(id) : undefined;
  return sender ? firstName(sender) : null;
}

export function letterSenderId(letter: Pick<FileRef, "from_human_id" | "from_house" | "to_house" | "sent_by_human_id">): string | null {
  return housesOf(letter)?.fromHumanId ?? letter.sent_by_human_id ?? null;
}

/** The one line code puts on the Card ahead of the person's words, so
 * they make sense in the graph without the letter beside them. The only
 * text on a Card its person did not say. */
export function reflectionLead(title: string, from: string | null): string {
  return from ? `Reading "${title}", from ${from}:` : `Reading "${title}":`;
}

/**
 * The person's click: their words go onto their Card for the day on this
 * project and the day is copied into the project, the way a taken
 * suggestion is. The caller has already found them shown the letter
 * (`letterForReader`); the Card door reads their own place on the
 * project. If the Card can't be written nothing is kept.
 */
export async function keepReflection(
  project: VaultFolder,
  letter: FileRef,
  speaker: { humanId: string; features: readonly Feature[] },
  input: { text: string; date?: string },
): Promise<ReflectionResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: "Say something first." };
  const row = await getReflection(letter._id, speaker.humanId);
  if (row?.text) return { ok: false, status: 409, error: REFLECTION_KEPT_ALREADY };
  if (!speaker.features.includes("dailyLog")) return { ok: false, status: 403, error: "You're not on this project's log, so this can't go on its record." };
  const date = markDate(input.date);
  let card: { fileId: string; suggestion: boolean };
  try {
    card = await appendToCard({
      humanId: speaker.humanId,
      date,
      projectFolderId: project._id,
      text: `${reflectionLead(letterTitle(letter), await letterSenderName(letter))}\n\n${text}`,
      features: speaker.features,
    });
  } catch (err) {
    console.error(`[letters] a reflection on letter ${letter._id} could not be kept:`, err);
    return { ok: false, status: 500, error: "That couldn't be kept. Try again." };
  }
  await writeReflection(letter._id, project._id, speaker.humanId, { draft: null, text, kept_at: new Date().toISOString(), kept_date: date, card_file_id: card.fileId, suggestion: card.suggestion });
  try {
    await runDailyLogSync(project._id, { date });
  } catch {
    // The next run copies the day.
  }
  return { ok: true, suggestion: card.suggestion };
}

/**
 * A kept reflection a letter may be started from, or null. All of: it is
 * this person's, it is kept, they may still open the letter it is about
 * (`resolveSentLetterForMember`: sent, not archived, their house), and
 * that letter is in this project. The last is what keeps a letter's
 * words, and what was said about it, from being carried into another
 * project's workings. Whether this person may write letters at all, and
 * that nobody is looking as them, is the caller's to ask.
 */
export async function reflectionToStartFrom(project: VaultFolder, letterFileId: string, humanId: string): Promise<{ row: LetterReflectionRow & { text: string }; letter: FileRef; title: string; from: string | null } | null> {
  const read = await resolveSentLetterForMember(letterFileId, humanId);
  if (!read || read.project._id !== project._id) return null;
  const row = await getReflection(letterFileId, humanId);
  if (!row?.text || !row.card_file_id) return null;
  return { row: row as LetterReflectionRow & { text: string }, letter: read.file, title: letterTitle(read.file), from: await letterSenderName(read.file) };
}

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const REFLECTION_KEPT_ALREADY = "You've already kept what you said about this letter.";
