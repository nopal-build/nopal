/**
 * The real, vault-backed `MentionSearch` implementation (see
 * `oxmarkdown/mention.ts`) — the server-side half of `@` mentions on real
 * routes (Daily Log today; Vault/`ProjectView` later). The demo mock on
 * `fruits/styles/oxmarkdown` has its own small in-memory stand-in; this is
 * the real thing, called from `routes/api.mentions.search.tsx`.
 *
 * Behavior, per spec:
 *   - Empty query: the human's 5 most recently SELECTED mentions
 *     (`mentionHistory.server.ts`); if there's no history yet, falls back
 *     to their 5 most recently updated project folders.
 *   - Non-empty query: a real search across the human's own folders and
 *     files, closest-match-first (`searchVaultEntries`).
 *
 * This is the ONE place that adds the `/humanId:...` prefix to a path —
 * `vault.server.ts`'s helpers deal in plain, vault-relative paths, and
 * `mentionHistory.server.ts` stores whatever full path was already
 * inserted (no prefixing needed there, it's already in the recorded path).
 */

import type { MentionItem } from "../oxmarkdown/mention";
import { getRecentMentions } from "./mentionHistory.server";
import { getRecentProjectFolders, searchVaultEntries } from "./vault.server";

export async function searchMentions(
  humanId: string,
  rawQuery: string,
): Promise<MentionItem[]> {
  const query = rawQuery.trim();

  if (!query) {
    const recent = await getRecentMentions(humanId, 5);
    if (recent.length > 0) return recent;

    const projects = await getRecentProjectFolders(humanId, 5);
    return projects.map((folder) => ({
      name: folder.name,
      path: `/${humanId}:projects/${folder.name}`,
    }));
  }

  const results = await searchVaultEntries(humanId, query, 8);
  return results.map((r) => ({ name: r.name, path: `/${humanId}:${r.path}` }));
}
