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
 *     ACTUALLY files it into the project now (`copyFileIntoFolder`, a new
 *     `file_refs` row in the project's own folder pointing at the same S3
 *     bytes, no duplication) rather than just logging a link back to the
 *     daily-log copy — see `releaseLog.server.ts`'s Release Log module doc
 *     for the structured entry/changeset this produces.
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
  type DailyLogCard,
} from "./dailyLog.server";
import {
  copyFileIntoFolder,
  getAccessibleProjectFolders,
  getFileRefById,
  getProjectFolders,
  listFolderChildren,
} from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";
import {
  createReleaseLogEntry,
  findReleaseLogEntryBySource,
  getReleaseLogContent,
  regenerateDailyReleaseLog,
  regenerateProjectReleaseLog,
  type ChangesetInput,
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

/** Every `::file{...}` attachment's `fileId`/`name`/`caption`, in document
 * order — see `oxmarkdown/fileDirective.ts` for the directive shape (a
 * built-in leaf directive, not a caller-registered one). `caption` is
 * `""` when the human never wrote one — see `preCapture.server.ts` for
 * the one caller that actually uses it (everyone else here only ever
 * needed `fileId`/`name`). */
export function extractFileAttachments(
  markdown: string,
): { fileId: string; name: string; caption: string }[] {
  const doc = parseOxDocument(markdown);
  const files: { fileId: string; name: string; caption: string }[] = [];
  walk(doc as unknown as AnyNode, (node) => {
    if (node.type !== "leafDirective") return;
    const directive = node as unknown as DirectiveNode;
    if (directive.name !== "file") return;
    const attrs = directiveAttrs(directive);
    if (attrs.fileId) {
      files.push({ fileId: attrs.fileId, name: attrs.name || "file", caption: attrs.caption ?? "" });
    }
  });
  return files;
}

// ─── File attachments — shared with the PhyLog Agent ─────────────────────

export type FiledAttachment = { fileId: string; name: string };

export function isImageContentType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/** The sibling summary markdown filename PhyLog's pre-capture stage
 * (`preCapture.server.ts`) writes right next to a source file —
 * `IMG_1523.jpeg` -> `IMG_1523-summary.md`. Shared here (rather than
 * defined in that module) so `fileCardAttachments` below can find and file
 * the pair together without an import cycle (`preCapture.server.ts`
 * already imports THIS file for `extractFileAttachments`). */
export function summaryFileName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}-summary.md`;
}

function fileSnapshot(file: FileRef) {
  return {
    human_id: file.human_id,
    name: file.name,
    content_type: file.content_type,
    s3_url: file.s3_url,
    s3_key: file.s3_key,
    content: file.content,
    content_hash: file.content_hash,
    folder_id: file.folder_id,
    size: file.size,
  };
}

/**
 * Files every NOT-YET-filed `::file{...}` attachment in `card`'s content
 * into its own project's root folder — same reasoning as `sortDailyLog`'s
 * own module doc (a Card is already an explicit, project-scoped section,
 * so no inference is needed about WHICH project; "which folder inside the
 * project" isn't a real question either — everything lands in its root,
 * same as it always has here). Extracted so PhyLog's own capture stage
 * (`capture.server.ts`) can perform this exact same deterministic step
 * directly — per the PhyLog design conversation ("the Sorter should just
 * be one part of the process... PhyLog should define what can be done"), a
 * Card's photos shouldn't need a separate `nopal sort run` first just to
 * reach the project.
 *
 * Both callers share the exact same idempotency key (`kind: "file-added"`,
 * `sourceRef` derived from the Card's own fileId + the attachment's own
 * fileId, checked via `findReleaseLogEntryBySource` BEFORE copying) —
 * running the Sorter AND the PhyLog Agent for the same day never files the
 * same attachment twice.
 *
 * `dryRun: true` only REPORTS which attachments are still pending (in
 * `pending`) — no copy, no Release Log entry, nothing written. Callers
 * are responsible for regenerating both release-log.md reflections
 * (`regenerateProjectReleaseLog`/`regenerateDailyReleaseLog`) when
 * `filed.length > 0`, same as any other Release Log write.
 */
export async function fileCardAttachments(
  card: DailyLogCard,
  date: string,
  actingHumanId: string,
  { dryRun }: { dryRun: boolean },
): Promise<{ filed: FiledAttachment[]; pending: FiledAttachment[] }> {
  const filed: FiledAttachment[] = [];
  const pending: FiledAttachment[] = [];

  for (const attachment of extractFileAttachments(card.content)) {
    // Checked BEFORE copying — idempotency has to guard the actual
    // file-copy mutation itself, not just the log entry, or a forced
    // re-run would add a second copy of the same attachment to the
    // project every time it runs.
    const sourceRef = `${card.fileId}:${attachment.fileId}`;
    const alreadyRecorded = await findReleaseLogEntryBySource(
      card.projectFolderId,
      date,
      "file-added",
      sourceRef,
    );
    if (alreadyRecorded) continue;

    if (dryRun) {
      pending.push({ fileId: attachment.fileId, name: attachment.name });
      continue;
    }

    const added = await copyFileIntoFolder(attachment.fileId, card.projectFolderId);
    if (!added) continue; // source file or project folder vanished mid-flight

    const changesets: ChangesetInput[] = [
      {
        fileId: added._id,
        action: "created",
        before: null,
        after: { ...fileSnapshot(added), folder_id: added.folder_id ?? card.projectFolderId },
      },
    ];

    // A photo's own AI-generated descriptor (`photoPreprocess.server.ts`)
    // lives right next to it in the daily log — file the PAIR together as
    // one signal, rather than leaving the descriptor behind. Bundled into
    // this SAME entry (two changesets) rather than a second entry, since
    // it's really one event: "this photo (and what PhyLog made of it)
    // reached the project".
    if (isImageContentType(added.content_type)) {
      const source = await getFileRefById(attachment.fileId);
      if (source?.folder_id) {
        const { files: siblings } = await listFolderChildren(source.human_id, source.folder_id);
        const descriptorListing = siblings.find(
          (f) => f.name === summaryFileName(source.name),
        );
        if (descriptorListing) {
          const addedDescriptor = await copyFileIntoFolder(
            descriptorListing._id,
            card.projectFolderId,
          );
          if (addedDescriptor) {
            changesets.push({
              fileId: addedDescriptor._id,
              action: "created",
              before: null,
              after: {
                ...fileSnapshot(addedDescriptor),
                folder_id: addedDescriptor.folder_id ?? card.projectFolderId,
              },
            });
          }
        }
      }
    }

    const { created } = await createReleaseLogEntry({
      projectFolderId: card.projectFolderId,
      date,
      actingHumanId,
      kind: "file-added",
      summary: `Added file "${added.name}" — [View](/fruits/vault?file=${added._id})`,
      sourceRef,
      changesets,
    });
    if (created) filed.push({ fileId: added._id, name: added.name });
  }

  return { filed, pending };
}

// ─── Kill switch ────────────────────────────────────────────────────────

/**
 * Whether the Sorter is allowed to run at all right now — checked by both
 * API routes (`api.daily-log.sort.tsx`/`sort-all.tsx`) and the cron
 * scheduler (`server.js`). Defaults to OFF (same "absent env var = feature
 * off" convention `CRON_SECRET` already uses for the cron itself), so a
 * fresh deploy never sorts real production daily logs until this is
 * explicitly turned on. Flip it on (locally or via `fly secrets set
 * SORTER_ENABLED=true`) once the Sorter's next phase (real project-folder
 * filing, not just release-log links) is ready to run for real again.
 */
export function isSorterEnabled(): boolean {
  return process.env.SORTER_ENABLED === "true";
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

/**
 * Sorts one human's one day. Safe to call repeatedly — a no-op (returns
 * `alreadySorted: true`) once `sortedAt` is set, unless `force`. Also safe
 * to FORCE repeatedly without creating duplicate entries or re-copying the
 * same file into a project twice — every entry is keyed by a stable
 * `sourceRef` (see `releaseLog.server.ts`) derived from the ORIGINATING
 * signal (a task's own text, an attachment's own fileId, ...), never from
 * anything a re-run itself would create fresh.
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
  const [cards, projectFolders, accessibleProjectFolders, { dateFolderId, readmeFileId }] =
    await Promise.all([
      getDailyLogCards(humanId, date),
      // @mentions only ever reach a human's OWN projects (cross-human
      // mentions aren't yet actionable — see `resolveMentionedProject`).
      getProjectFolders(humanId),
      // Cards, however, CAN target a project shared with `humanId` (any
      // Sharing Role, including Observer) — needed for `projectsTouched`
      // name resolution below.
      getAccessibleProjectFolders(humanId),
      getDailyLogFolderAndReadmeId(humanId, date),
    ]);

  const touchedProjectIds = new Set<string>();
  let entriesWritten = 0;

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
      const { created } = await createReleaseLogEntry({
        projectFolderId: project._id,
        date,
        actingHumanId: humanId,
        kind: "mention",
        summary: `Mentioned in the daily log — [View](/fruits/vault?file=${readmeFileId})`,
        sourceRef: readmeFileId,
      });
      if (created) entriesWritten++;
    }
  }

  // 2) Cards — everything inside one is unambiguously that project's, no
  // inference needed (Cards replace ambiguous file-association).
  for (const card of cards) {
    touchedProjectIds.add(card.projectFolderId);

    for (const taskText of extractCompletedTasks(card.content)) {
      const { created } = await createReleaseLogEntry({
        projectFolderId: card.projectFolderId,
        date,
        actingHumanId: humanId,
        kind: "task",
        summary: `Completed task: "${taskText}" — [View](/fruits/vault?file=${card.fileId})`,
        sourceRef: `${card.fileId}:${taskText}`,
      });
      if (created) entriesWritten++;
    }

    const { filed } = await fileCardAttachments(card, date, humanId, { dryRun: false });
    entriesWritten += filed.length;
  }

  await setDailyLogSorted(humanId, date, new Date().toISOString());

  for (const projectId of touchedProjectIds) {
    await regenerateProjectReleaseLog(projectId);
  }
  await regenerateDailyReleaseLog(humanId, date, dateFolderId);

  const projectsTouched = [...touchedProjectIds]
    .map((id) => accessibleProjectFolders.find((f) => f._id === id)?.name)
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
