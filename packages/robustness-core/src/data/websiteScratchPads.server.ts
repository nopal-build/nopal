// packages/robustness-core/src/data/websiteScratchPads.server.ts
//
// DB-backed "Pads" for `/maker/stamps/scratch` -- a Pad groups an ORDERED
// list of scratch ids together (e.g. "The Terrain": Intro, At a Cost, The
// Trade, ...) so they can be previewed as one combined document (all
// member scratches' markdown joined together) instead of one at a time.
// Simpler than `websiteScratches.server.ts`'s scratches: a Pad has no
// hardcoded/code-defined counterpart at all, so every row IS the Pad --
// there's no "built-in vs. override" distinction here, just plain
// create/read/update/delete.
//
// Membership is many-to-many in practice (a scratch id can appear in more
// than one Pad, or none) -- a Pad only stores which ids it contains, not
// the other direction; a scratch has no idea which Pad(s) reference it.
import { RecordId } from "surrealdb";
import { query, upsert, remove, formatRecord, defineTable, type Data } from "./generic.server";

const TABLE = "website_scratch_pads";

export type WebsiteScratchPadFields = {
  name: string;
  scratchIds: string[];
};

export type WebsiteScratchPad = Data & WebsiteScratchPadFields & { updated_at: string };

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

export async function getWebsiteScratchPads(): Promise<
  Array<{ id: string } & WebsiteScratchPadFields>
> {
  await ensureTable();
  const result = await query<[WebsiteScratchPad[]]>(`SELECT * FROM ${TABLE}`);
  const rows = (result?.[0] ?? []).map(formatRecord);
  return rows.map((row) => ({
    id: row._id,
    name: row.name,
    scratchIds: Array.isArray(row.scratchIds) ? row.scratchIds : [],
  }));
}

/** Creates a new, empty Pad and returns its id. */
export async function createWebsiteScratchPad(): Promise<string> {
  await ensureTable();
  const id = `pad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await upsert(new RecordId(TABLE, id), {
    name: "New pad",
    scratchIds: [],
    updated_at: new Date().toISOString(),
  });
  return id;
}

/** Persists `fields` as Pad `padId`'s new current state (name + full
 * ordered membership list, together -- same "whole row, every save"
 * convention `saveWebsiteScratchOverride` uses). */
export async function saveWebsiteScratchPad(
  padId: string,
  fields: WebsiteScratchPadFields,
): Promise<void> {
  await ensureTable();
  await upsert(new RecordId(TABLE, padId), {
    ...fields,
    updated_at: new Date().toISOString(),
  });
}

/** Deletes Pad `padId` -- its member scratches are NOT deleted, they just
 * become ungrouped again (or stay grouped under any other Pad they're
 * also in). */
export async function deleteWebsiteScratchPad(padId: string): Promise<void> {
  await ensureTable();
  await remove(TABLE, padId);
}
