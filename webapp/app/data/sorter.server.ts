/**
 * The Sorter — turns EXPLICIT signals already present in a closed daily
 * log into Release Log entries. Deliberately zero-inference: it never
 * guesses which project some unlabeled prose belongs to (decision: an
 * unlabeled daily-log paragraph is left untouched, no forced sorting, no
 * "personal" catch-all). It only ever acts on:
 *
 *   - An `@mention` link in the day's own prose that points at one of the
 *     human's OWN project folders — logs a backlink (project mentioned).
 *   - A completed task (`[x]`) inside a Card — a Card is already an
 *     explicit, project-scoped section, so no inference is needed to know
 *     which project a task inside it belongs to.
 *   - A file attachment (`::file{...}`) inside a Card — same reasoning.
 *
 * Runs once per closed day per human, idempotently (`DailyLog.sortedAt` —
 * see `dailyLog.server.ts`). Triggered two ways, both landing on this same
 * function: the once-a-day cron (`sortAllDueDailyLogs`, wired into
 * `server.js` the same way `archive-cleanup` already is) for every human
 * automatically, and `POST /api/daily-log/sort` for a human/CLI/future
 * sorting agent to trigger on demand (see the `apiTokens.server.ts`
 * `"sorter"` scope) — this is the "CLI/API is the agent's tool surface"
 * design: one real implementation, usable by both.
 */

import {
  getDailyLogByDate,
  getDailyLogCards,
  getDailyLogFolderAndReadmeId,
  getUnsortedDailyLogsBefore,
  setDailyLogSorted,
} from "./dailyLog.server";
import { getProjectFolders } from "./vault.server";
import type { VaultFolder } from "./vault.types";
import {
  appendDailyReleaseLogEntries,
  appendProjectReleaseLogEntries,
  getReleaseLogContent,
} from "./releaseLog.server";
import {
  directiveAttrs,
  parseOxDocument,
  type DirectiveNode,
} from "../oxmarkdown/document";

// ─── Markdown extraction (pure — no vault I/O) ─────────────────────────────

/** A minimal shape covering every mdast/directive/GFM node this file walks
 * — deliberately loose rather than importing every extension's own node
 * type, since all that's needed here is `.type`/`.children`/a couple of
 * extension-specific fields read defensively. */
type AnyNode = {
  type: string;
  children?: AnyNode[];
  value?: string;
  url?: string;
  checked?: boolean | null;
};

function walk(node: AnyNode, visitor: (node: AnyNode) => void): void {
  visitor(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visitor);
  }
}

const MENTION_HREF_RE = /^\/([^:]+):projects\/([^/]+)/;

/** Resolves an `@mention`'s link href (`/humanId:projects/Name[...]`) to
 * the project `VaultFolder` it points at — or `null` when it's not a
 * mention of a PROJECT at all (a personal/daily-log/syncs mention), or a
 * mention into someone else's vault (cross-human mentions aren't yet
 * actionable — mirrors the same scope line Cards already draw at
 * `getProjectFolders`: owned projects only). */
function resolveMentionedProject(
  humanId: string,
  href: string,
  projectFolders: VaultFolder[],
): VaultFolder | null {
  const match = MENTION_HREF_RE.exec(href);
  if (!match) return null;
  const [, mentionedHumanId, rawName] = match;
  if (mentionedHumanId !== humanId) return null;
  const name = decodeURIComponent(rawName);
  return projectFolders.find((f) => f.name === name) ?? null;
}

/** Every project mentioned via an `@mention` link anywhere in `markdown`
 * — deduped, in first-seen order. */
export function extractMentionedProjects(
  humanId: string,
  markdown: string,
  projectFolders: VaultFolder[],
): VaultFolder[] {
  const doc = parseOxDocument(markdown);
  const seen = new Set<string>();
  const result: VaultFolder[] = [];
  walk(doc as unknown as AnyNode, (node) => {
    if (node.type !== "link" || !node.url) return;
    const project = resolveMentionedProject(humanId, node.url, projectFolders);
    if (project && !seen.has(project._id)) {
      seen.add(project._id);
      result.push(project);
    }
  });
  return result;
}

function nodeText(node: AnyNode): string {
  let text = "";
  walk(node, (n) => {
    if (n.type === "text" && n.value) text += n.value;
  });
  return text.trim();
}

/** Every checked (`[x]`) task's own text, in document order. GFM's
 * task-list extension (already wired into `parseOxDocument`) marks a
 * `listItem` node's `checked` true/false/null. */
export function extractCompletedTasks(markdown: string): string[] {
  const doc = parseOxDocument(markdown);
  const tasks: string[] = [];
  walk(doc as unknown as AnyNode, (node) => {
    if (node.type === "listItem" && node.checked === true) {
      tasks.push(nodeText(node));
    }
  });
  return tasks;
}

/** Every `::file{...}` attachment's `fileId`/`name`, in document order —
 * see `oxmarkdown/fileDirective.ts` for the directive shape (a built-in
 * leaf directive, not a caller-registered one). */
export function extractFileAttachments(
  markdown: string,
): { fileId: string; name: string }[] {
  const doc = parseOxDocument(markdown);
  const files: { fileId: string; name: string }[] = [];
  walk(doc as unknown as AnyNode, (node) => {
    if (node.type !== "leafDirective") return;
    const directive = node as unknown as DirectiveNode;
    if (directive.name !== "file") return;
    const attrs = directiveAttrs(directive);
    if (attrs.fileId) files.push({ fileId: attrs.fileId, name: attrs.name || "file" });
  });
  return files;
}

// ─── Orchestration ──────────────────────────────────────────────────────

export type SortSummary = {
  date: string;
  alreadySorted: boolean;
  projectsTouched: string[];
  entriesWritten: number;
  /** The day's own `release-log.md` content AFTER this run — lets a
   * caller (the Daily Log page's manual "Sort this day" testing button)
   * show exactly what's there without a second round-trip. `""` when the
   * day has never been sorted into anything, or never existed at all. */
  dailyReleaseLog: string;
};

function pushLine(map: Map<string, string[]>, key: string, line: string): void {
  const existing = map.get(key);
  if (existing) existing.push(line);
  else map.set(key, [line]);
}

/**
 * Sorts one human's one day. Safe to call repeatedly — a no-op (returns
 * `alreadySorted: true`) once `sortedAt` is set, unless `force`.
 */
export async function sortDailyLog(
  humanId: string,
  date: string,
  { force = false }: { force?: boolean } = {},
): Promise<SortSummary> {
  const existingLog = await getDailyLogByDate(humanId, date);
  if (existingLog?.sortedAt && !force) {
    const { dateFolderId } = await getDailyLogFolderAndReadmeId(humanId, date);
    const dailyReleaseLog = await getReleaseLogContent(humanId, dateFolderId);
    return { date, alreadySorted: true, projectsTouched: [], entriesWritten: 0, dailyReleaseLog };
  }
  // No `daily_logs` cache row at all (this date never had a readme.md
  // saved) — nothing to sort, and nothing to mark either: `setDailyLogSorted`
  // uses a `merge`, which would otherwise silently create a malformed
  // daily_logs record missing `humanId`/`date`/`content` (SurrealQL's
  // MERGE creates the record when it's missing) — one that could never
  // again be found by `getDailyLogByDate`'s own humanId+date filter, so
  // this exact guard would keep re-triggering on every future call.
  // Deliberately does NOT resolve/create the date's own vault folder just
  // to check for a release-log.md that couldn't possibly exist yet.
  if (!existingLog) {
    return { date, alreadySorted: false, projectsTouched: [], entriesWritten: 0, dailyReleaseLog: "" };
  }

  const readmeContent = existingLog?.content ?? "";
  const [cards, projectFolders, { dateFolderId, readmeFileId }] = await Promise.all([
    getDailyLogCards(humanId, date),
    getProjectFolders(humanId),
    getDailyLogFolderAndReadmeId(humanId, date),
  ]);

  // project id -> bullet lines for THAT project's own release-log.md
  const projectEntries = new Map<string, string[]>();
  // project id -> bullet lines for the DAY's own release-log.md
  const dailyEntries = new Map<string, string[]>();
  const touchedProjectIds = new Set<string>();

  // 1) @mentions in the day's own prose — a project backlink. Only
  // possible once the readme's own file exists (it always does for any
  // day with real cached content).
  if (readmeFileId) {
    const mentionedProjects = extractMentionedProjects(
      humanId,
      readmeContent,
      projectFolders,
    );
    for (const project of mentionedProjects) {
      touchedProjectIds.add(project._id);
      pushLine(
        projectEntries,
        project._id,
        `- Mentioned in the daily log — [View](/fruits/vault?file=${readmeFileId})`,
      );
      pushLine(
        dailyEntries,
        project._id,
        `- Mentioned this project — [View](/fruits/vault?folder=${project._id})`,
      );
    }
  }

  // 2) Cards — everything inside one is unambiguously that project's, no
  // inference needed (Cards replace ambiguous file-association).
  for (const card of cards) {
    touchedProjectIds.add(card.projectFolderId);

    for (const taskText of extractCompletedTasks(card.content)) {
      const line = `- Completed task: "${taskText}" — [View](/fruits/vault?file=${card.fileId})`;
      pushLine(projectEntries, card.projectFolderId, line);
      pushLine(dailyEntries, card.projectFolderId, line);
    }

    for (const attachment of extractFileAttachments(card.content)) {
      const line = `- Added file "${attachment.name}" — [View](/fruits/vault?file=${attachment.fileId})`;
      pushLine(projectEntries, card.projectFolderId, line);
      pushLine(dailyEntries, card.projectFolderId, line);
    }
  }

  let entriesWritten = 0;
  for (const [projectId, lines] of projectEntries) {
    await appendProjectReleaseLogEntries(humanId, projectId, date, lines);
    entriesWritten += lines.length;
  }
  for (const [projectId, lines] of dailyEntries) {
    await appendDailyReleaseLogEntries(humanId, dateFolderId, projectId, lines);
  }

  await setDailyLogSorted(humanId, date, new Date().toISOString());

  const projectsTouched = [...touchedProjectIds]
    .map((id) => projectFolders.find((f) => f._id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const dailyReleaseLog = await getReleaseLogContent(humanId, dateFolderId);

  return { date, alreadySorted: false, projectsTouched, entriesWritten, dailyReleaseLog };
}

function utcDateString(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Sorts every human's backlog of closed, not-yet-sorted days in one pass
 * — what the once-a-day cron calls (see `api.daily-log.sort-all.tsx`).
 *
 * "Closed" here means strictly before today's UTC date — a intentionally
 * simple 1-day margin, not the more conservative 2-day margin
 * `isFileRefLocked` uses for locking uploads: sorting a day slightly
 * early (before every possible timezone has truly finished their local
 * "today") just means a very-late entry gets picked up on the NEXT day's
 * run instead — self-healing, same as `archive-cleanup`'s own robustness,
 * not a permanent miss.
 */
export async function sortAllDueDailyLogs(): Promise<{
  processed: number;
  results: Array<{
    humanId: string;
    date: string;
    entriesWritten: number;
    error?: string;
  }>;
}> {
  const cutoff = utcDateString(0);
  const dueLogs = await getUnsortedDailyLogsBefore(cutoff);
  const results: Array<{
    humanId: string;
    date: string;
    entriesWritten: number;
    error?: string;
  }> = [];

  for (const log of dueLogs) {
    try {
      const summary = await sortDailyLog(log.humanId, log.date);
      results.push({
        humanId: log.humanId,
        date: log.date,
        entriesWritten: summary.entriesWritten,
      });
    } catch (err) {
      results.push({
        humanId: log.humanId,
        date: log.date,
        entriesWritten: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: results.length, results };
}
