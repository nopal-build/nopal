/**
 * Release Log — the append-only, human-readable record of what the Sorter
 * (`sorter.server.ts`) did. Deliberately NOT a confirmation-gated review
 * queue: the system acts on an explicit signal (a Card, or an `@mention`)
 * and just logs what it did — see the `vault` skill's "Cards" section and
 * the project handoff notes.
 *
 * Every entry is written to BOTH places on purpose (same data, two views):
 *   - `daily-logs/YYYY-MM-DD/release-log.md` — that human's own receipt
 *     for the day, grouped by project (`## <Project Name>`).
 *   - `projects/<name>/release-log.md` — everyone with project access,
 *     grouped by date (`## YYYY-MM-DD`).
 *
 * A single markdown file per project (decision: manual overflow via a
 * hand-created `release-log-p2.md` only if one ever becomes unwieldy — no
 * pre-emptive partitioning). Plain markdown bullets today, not yet the
 * `::release-item{...}` directive the original design sketched for
 * per-viewer conditional link rendering (an entry authored by someone
 * else renders as plain "by Jane" text; your own renders as a real link
 * back to your own daily log) — every entry the Sorter can produce today
 * is necessarily self-authored (mentions/Cards only ever reach a human's
 * OWN projects, no sharing yet), so that nuance has no observable effect
 * yet. Tracked as a follow-up once shared-project filing exists.
 */

import {
  createFileRef,
  getFolderById,
  updateFileRef,
} from "./vault.server";
import { query, formatRecord } from "./generic.server";
import type { FileRef } from "./vault.types";

const RELEASE_LOG_FILENAME = "release-log.md";

async function getOrCreateReleaseLogFile(
  humanId: string,
  folderId: string,
): Promise<FileRef> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId AND folder_id = $folderId AND name = $name
     LIMIT 1`,
    { humanId, folderId, name: RELEASE_LOG_FILENAME },
  );
  const existing = result?.[0]?.[0]
    ? formatRecord(result[0][0] as unknown as FileRef)
    : null;
  if (existing) return existing;

  const created = await createFileRef({
    human_id: humanId,
    name: RELEASE_LOG_FILENAME,
    content: "",
    content_type: "text/markdown",
    folder_id: folderId,
  });
  if (!created) throw new Error("Failed to create release-log.md");
  return created;
}

/**
 * Inserts `bulletLines` under a `## <heading>` section, creating that
 * section at the end of the document if it doesn't exist yet. Appends —
 * never rewrites or reorders existing sections — matching the "append-
 * only, readable like a traditional changelog" design.
 *
 * A plain line-based insert rather than a full mdast round-trip: headings
 * are simple, unique `## ...` markers here (not nested/emphasized), so a
 * dumb text scan is enough and keeps this file's own formatting (blank
 * lines, indentation of nested bullets) completely untouched everywhere
 * outside the one section being appended to.
 */
function appendUnderHeading(
  content: string,
  heading: string,
  bulletLines: string[],
): string {
  const headingLine = `## ${heading}`;
  const lines = content.length > 0 ? content.split("\n") : [];
  const headingIdx = lines.findIndex((l) => l.trim() === headingLine);

  if (headingIdx === -1) {
    const trimmed = content.replace(/\s+$/, "");
    const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
    return `${prefix}${headingLine}\n\n${bulletLines.join("\n")}\n`;
  }

  // Skip past any already-blank line right after the heading, then find
  // where this section ends (the next heading, or end of file).
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  // Trim trailing blank lines within the section so bullets land directly
  // after the last existing one, not after a growing gap of blank lines.
  let insertAt = sectionEnd;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }
  lines.splice(insertAt, 0, ...bulletLines);
  return lines.join("\n");
}

/**
 * Reads a folder's `release-log.md` content, or `""` if it doesn't exist
 * yet — read-only, never creates the file (unlike
 * `getOrCreateReleaseLogFile`, this is for REVIEWING what's already
 * there, e.g. `sortDailyLog`'s own return value for the manual "Sort this
 * day" testing button on the Daily Log page). */
export async function getReleaseLogContent(
  humanId: string,
  folderId: string,
): Promise<string> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId AND folder_id = $folderId AND name = $name
     LIMIT 1`,
    { humanId, folderId, name: RELEASE_LOG_FILENAME },
  );
  const existing = result?.[0]?.[0]
    ? formatRecord(result[0][0] as unknown as FileRef)
    : null;
  return existing?.content ?? "";
}

/**
 * Appends one or more bullet lines under a heading in a folder's
 * `release-log.md`, creating the file (and/or the heading section) if
 * needed. `bulletLines` should already be fully formatted (e.g.
 * `- Completed task: "..." — [View](...)`) — this function only handles
 * placement, not phrasing (see `sorter.server.ts` for the actual entry
 * text).
 */
export async function appendReleaseLogEntries(
  humanId: string,
  folderId: string,
  heading: string,
  bulletLines: string[],
): Promise<void> {
  if (bulletLines.length === 0) return;
  const file = await getOrCreateReleaseLogFile(humanId, folderId);
  const existingContent = file.content ?? "";
  // Insurance against a forced re-run (or the cron catching an already-
  // processed day some other way) writing the exact same line twice —
  // the PRIMARY defense is `DailyLog.sortedAt` short-circuiting the whole
  // run, this is just a cheap belt-and-suspenders check.
  const newLines = bulletLines.filter((line) => !existingContent.includes(line));
  if (newLines.length === 0) return;
  const updated = appendUnderHeading(existingContent, heading, newLines);
  await updateFileRef(file._id, { content: updated });
}

/** Convenience wrapper for a project's own `release-log.md`, grouped by
 * date — `projectFolderId` is the project's own vault folder (a direct
 * child of the `projects` root), and `release-log.md` lives directly
 * inside it, right alongside the project's `README.md` (and its `skills/`
 * folder, if present — see the vault skill / `vaultFolderTypes.ts`). */
export async function appendProjectReleaseLogEntries(
  humanId: string,
  projectFolderId: string,
  date: string,
  bulletLines: string[],
): Promise<void> {
  await appendReleaseLogEntries(humanId, projectFolderId, date, bulletLines);
}

/** Convenience wrapper for a day's own `release-log.md`, grouped by
 * project name — resolves the project's CURRENT name fresh every time
 * (never cached), same convention `getDailyLogCards` already uses for a
 * Card's `projectName`. */
export async function appendDailyReleaseLogEntries(
  humanId: string,
  dateFolderId: string,
  projectFolderId: string,
  bulletLines: string[],
): Promise<void> {
  const projectFolder = await getFolderById(projectFolderId);
  const heading = projectFolder?.name ?? "Unknown project";
  await appendReleaseLogEntries(humanId, dateFolderId, heading, bulletLines);
}
