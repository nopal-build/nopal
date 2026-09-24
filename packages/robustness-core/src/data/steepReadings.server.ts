/**
 * Steep readings: one tap on the Steep-o-meter, stored as who, which
 * project, which day and where on the scale (`steepScale.ts`).
 *
 * Kept out of everything that travels. A reading is not a file_ref (no
 * realtime event, no sync), not a mark (no `Syncs/Marks/` file, so never
 * a node, never on the Efforts page a client can read) and nothing here
 * sends anything to anyone. Who may see a reading is decided by the
 * dashboard's loader (`dashboard.server.ts`), never by the page: a
 * client's reading reaches the project's guides and observers only.
 *
 * One reading per person, per project, per day. Tapping again the same
 * day replaces it, so a mis-tap costs nothing.
 */

import { RecordId } from "surrealdb";
import { defineTable, query, upsert } from "./generic.server";
import { markDate } from "./graphLogMarks.server";
import type { SteepPosition } from "./steepScale";

const TABLE = "steep_readings";

export type SteepReading = {
  human_id: string;
  project_folder_id: string;
  position: SteepPosition;
  /** The person's own day (`YYYY-MM-DD`), as `markDate` accepts it. */
  date: string;
  created_at: string;
};

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  // Selecting from a table SurrealDB has never seen is an error, and the
  // dashboard reads this table before anyone has ever tapped.
  await defineTable(TABLE);
  tableEnsured = true;
}

export function readingDate(requested: string | undefined): string {
  return markDate(requested);
}

export async function saveSteepReading(input: {
  humanId: string;
  projectFolderId: string;
  position: SteepPosition;
  date: string;
}): Promise<SteepReading | null> {
  await ensureTable();
  const reading: SteepReading = {
    human_id: input.humanId,
    project_folder_id: input.projectFolderId,
    position: input.position,
    date: input.date,
    created_at: new Date().toISOString(),
  };
  const id = new RecordId(TABLE, [input.humanId, input.projectFolderId, input.date]);
  const result = await upsert(id, reading);
  return result ? reading : null;
}

/** Every reading on these projects on or after `sinceDate`, oldest first. */
export async function listSteepReadings(
  projectFolderIds: string[],
  sinceDate: string,
): Promise<SteepReading[]> {
  if (projectFolderIds.length === 0) return [];
  await ensureTable();
  const result = await query<[SteepReading[]]>(
    `SELECT human_id, project_folder_id, position, date, created_at FROM ${TABLE}
     WHERE project_folder_id IN $ids AND date >= $since ORDER BY date ASC`,
    { ids: projectFolderIds, since: sinceDate },
  );
  return result?.[0] ?? [];
}
