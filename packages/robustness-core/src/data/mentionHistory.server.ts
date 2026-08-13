/**
 * Recency tracking for `@` mentions — backs the "empty search returns your
 * last few mentions" behavior (`mentionSearch.server.ts`). Deliberately its
 * own tiny table, not bolted onto `Human` or `vault_folders`/`file_refs`:
 * this is purely a per-human, per-target "when did you last pick this"
 * fact, unrelated to the target's own lifecycle (renaming/moving/deleting
 * the real folder or file doesn't need to touch this at all).
 *
 * Keyed by `(humanId, path)`, upserted on every selection — picking the
 * same target again just bumps its recency rather than creating a
 * duplicate row, mirroring `daily_logs`' one-row-per-(human, date) shape.
 */

import { query, formatRecord, merge, type Data } from "./generic.server";

export type MentionHistoryEntry = Data & {
  humanId: string;
  name: string;
  path: string;
  selectedAt: string;
};

export async function recordMentionSelection(
  humanId: string,
  item: { name: string; path: string },
): Promise<void> {
  const now = new Date().toISOString();
  const result = await query<[MentionHistoryEntry[]]>(
    `SELECT * FROM mention_history WHERE humanId = $humanId AND path = $path LIMIT 1;`,
    { humanId, path: item.path },
  );
  const existing = result?.[0]?.[0] ? formatRecord(result[0][0]) : null;

  if (existing) {
    await merge("mention_history", existing._id, {
      name: item.name,
      selectedAt: now,
    });
    return;
  }

  await query(
    `CREATE mention_history SET humanId = $humanId, name = $name, path = $path, selectedAt = $selectedAt;`,
    { humanId, name: item.name, path: item.path, selectedAt: now },
  );
}

/** Most recently selected mentions, newest first. Returns `{name, path}`
 * pairs only — `path` was already the full, human-scoped path at selection
 * time, so nothing here needs to re-derive or re-prefix it. */
export async function getRecentMentions(
  humanId: string,
  limit = 5,
): Promise<{ name: string; path: string }[]> {
  // `selectedAt` has to be part of the projection for SurrealDB to accept
  // ordering by it (confirmed directly: a bare `SELECT name, path ... ORDER
  // BY selectedAt` is rejected with "Missing order idiom `selectedAt` in
  // statement selection") — selected here and simply left off the return
  // shape below.
  const result = await query<[MentionHistoryEntry[]]>(
    `SELECT name, path, selectedAt FROM mention_history WHERE humanId = $humanId ORDER BY selectedAt DESC LIMIT $limit;`,
    { humanId, limit },
  );
  return (result?.[0] ?? []).map(({ name, path }) => ({ name, path }));
}
