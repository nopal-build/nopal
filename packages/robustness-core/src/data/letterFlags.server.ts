/**
 * The mailbox flag (Austin, 2026-11-05: "when you have mail, a little
 * purple mail flag pops up and you can read your mail"). Yours alone: up
 * while a letter that came to your house after you joined it is still
 * unopened by you.
 *
 * One row per (letter, person) and only while that person's flag is up
 * for that letter. Raised at Send for everyone in the receiving house at
 * that moment except the sender (`flagRecipients`), raised again by a
 * send again, taken away when that person opens the letter's page
 * (`public.letter.$fileId.tsx`). Opening the mailbox lowers nothing.
 *
 * What this is not: a record of who has read what. A row that is gone
 * says nothing about when or whether; nothing lists rows by letter, and
 * no page is given anyone's but the viewer's own. A row left behind by a
 * letter that was deleted, archived or moved is harmless: the flag is
 * "a letter in my mailbox has my row" (`flaggedLetterIds` meets the
 * mailbox in the project page's loader), never "I have a row".
 *
 * Its own table, not a field on the letter: the letter's record goes
 * whole to everyone in the guides' house through the Vault's routes.
 *
 * Who decides what. A person: sending, opening. Code: everything here.
 * No timer; a flag stays up until its person opens the letter.
 */

import { RecordId } from "surrealdb";
import { defineTable, query, remove, upsert } from "./generic.server";

const TABLE = "letter_flags";
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

/** One id per (letter, person), so raising twice is one row. */
export function letterFlagId(letterFileId: string, humanId: string): string {
  return `${letterFileId}__${humanId}`;
}

/** Puts the flag up for each person, for this letter. */
export async function raiseLetterFlags(input: { letterFileId: string; projectFolderId: string; humanIds: readonly string[]; at: string }): Promise<void> {
  if (input.humanIds.length === 0) return;
  await ensureTable();
  for (const humanId of input.humanIds) {
    await upsert(new RecordId(TABLE, letterFlagId(input.letterFileId, humanId)), {
      letter_file_id: input.letterFileId,
      project_folder_id: input.projectFolderId,
      human_id: humanId,
      raised_at: input.at,
    });
  }
}

/** This person opened this letter. Nothing to do when no flag was up. */
export async function lowerLetterFlag(letterFileId: string, humanId: string): Promise<void> {
  await ensureTable();
  await remove(TABLE, letterFlagId(letterFileId, humanId));
}

/** The letters on a project this person has a flag up for. Only ever
 * asked about the viewer themself. */
export async function flaggedLetterIds(projectFolderId: string, humanId: string): Promise<Set<string>> {
  await ensureTable();
  const result = await query<[{ letter_file_id: string }[]]>(
    `SELECT letter_file_id FROM ${TABLE} WHERE project_folder_id = $projectFolderId AND human_id = $humanId`,
    { projectFolderId, humanId },
  );
  return new Set((result?.[0] ?? []).map((r) => r.letter_file_id));
}
