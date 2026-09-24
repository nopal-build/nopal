// packages/robustness-core/src/data/websiteScratches.server.ts
//
// DB-backed overrides for `/maker/stamps/scratch`'s per-entry content --
// lets an Admin/Super edit + persist a `::directive` example's CURRENT
// name, directive signature, "Scratch info" description, and markdown from
// the scratch pad UI itself, in ANY environment (not just local dev),
// instead of hand-editing the `ENTRIES` array in
// `maker_.stamps_.scratch.tsx` and redeploying.
//
// A row's record id IS the `ScratchEntry.id` (e.g. "section", "line") --
// one row per entry, keyed directly by it, so save/read/revert are plain
// upsert/select/delete by id, no separate unique-index query needed. Each
// save writes ALL FOUR fields together (the UI edits them as one unit, with
// a single Save/Revert pair) -- so a row, once it exists, always reflects
// this entry's complete current state, not a partial patch layered over
// the hardcoded default.
import { RecordId } from "surrealdb";
import { query, upsert, remove, formatRecord, defineTable, type Data } from "./generic.server";

const TABLE = "website_scratches";

/** The subset of `ScratchEntry` that's actually DB-editable -- `id`
 * (the record key itself) and layout-only knobs (`fullBleed`/
 * `previewMinHeight`) stay defined in code only. */
export type WebsiteScratchOverrideFields = {
  name: string;
  directive: string;
  note: string;
  markdown: string;
};

export type WebsiteScratchOverride = Data &
  WebsiteScratchOverrideFields & {
    updated_at: string;
  };

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

/** Every saved override, keyed by `ScratchEntry.id` -- an id absent from
 * this map means "still showing that entry's own hardcoded defaults," not
 * an error. */
export async function getWebsiteScratchOverrides(): Promise<
  Record<string, WebsiteScratchOverrideFields>
> {
  await ensureTable();
  const result = await query<[WebsiteScratchOverride[]]>(`SELECT * FROM ${TABLE}`);
  const rows = (result?.[0] ?? []).map(formatRecord);
  const overrides: Record<string, WebsiteScratchOverrideFields> = {};
  for (const row of rows) {
    overrides[row._id] = {
      name: row.name,
      directive: row.directive,
      note: row.note,
      markdown: row.markdown,
    };
  }
  return overrides;
}

/** Persists `fields` as entry `entryId`'s new current state -- the next
 * load (this process or any other) sees it via `getWebsiteScratchOverrides`
 * until it's reverted. */
export async function saveWebsiteScratchOverride(
  entryId: string,
  fields: WebsiteScratchOverrideFields,
): Promise<void> {
  await ensureTable();
  await upsert(new RecordId(TABLE, entryId), {
    ...fields,
    updated_at: new Date().toISOString(),
  });
}

/** Deletes entry `entryId`'s saved override, if any -- the next load falls
 * back to that entry's own hardcoded defaults again. */
export async function revertWebsiteScratchOverride(entryId: string): Promise<void> {
  await ensureTable();
  await remove(TABLE, entryId);
}
