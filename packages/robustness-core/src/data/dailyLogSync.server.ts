/**
 * `daily-log-sync` — GraphLog's deterministic, non-agentic first stage (see
 * the `graphlog` skill). The Sorter's counterpart: a daily-log Card is
 * already explicitly scoped to one project (see the `vault` skill's Cards
 * section), so copying its content into that project's own
 * `syncs/Daily Logs/` folder needs no AI judgment at all — zero inference,
 * same philosophy as `sorter.server.ts`'s own module doc.
 *
 * Deliberately does NOT touch where the vault-wide `daily-logs` root itself
 * lives, or where the Daily Log page writes — that's a separate, higher-
 * risk migration (see the `graphlog` skill's "Daily Logs symlink" section)
 * affecting every existing human's real data, not something to fold into
 * this stage's first cut. This module only ever READS from the CURRENT
 * `daily-logs` root (via `listCardEntriesForProject`/`getDailyLogCards`) and
 * WRITES into a project's own `syncs/Daily Logs/` folder.
 */

import {
  createFileRef,
  createVaultFolder,
  getFolderById,
  listFolderChildren,
  updateFileRef,
  copyFileIntoFolder,
  type VaultFolder,
} from "./vault.server";
import { getDailyLogCards, listCardEntriesForProject } from "./dailyLog.server";
import { extractFileAttachments } from "./sorter.server";
import { createHash } from "node:crypto";

/** The reserved folder name daily-log-sync's own copies land in, directly
 * inside a project's `syncs` folder — a plain, ordinary folder (no
 * dedicated `SyncFolderTypeKey` of its own), same "reserved NAME by
 * convention" idea `_knowledge` uses one level deeper (see the `graphlog`
 * skill). Not the same folder as the vault-wide `daily-logs` ROOT, or
 * `project-n01`'s own `daily-logs` SPACE TYPE (PhyLog's pre-capture
 * staging area) — three different things that happen to share a name. */
export const DAILY_LOGS_SYNC_FOLDER_NAME = "Daily Logs";

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function ensureProjectSyncsFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const existing = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: "Syncs",
    parent_folder_id: projectFolder._id,
    folder_type: "syncs",
  });
  if (!created) throw new Error("Failed to create the project's syncs folder");
  return created;
}

/** Idempotently ensures the project's `syncs/Daily Logs` folder exists —
 * lazily created the first time daily-log-sync actually has a Card to copy
 * in, same "create on first real write" convention `ensureProjectGraphFolder`
 * (`projectN02.server.ts`) and `ensureProjectDailyLogsFolder`
 * (`projectN01.server.ts`) both use for their own system-managed folders. */
export async function ensureDailyLogsSyncFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const syncsFolder = await ensureProjectSyncsFolder(projectFolder);
  const { folders } = await listFolderChildren(projectFolder.human_id, syncsFolder._id);
  const existing = folders.find((f) => f.name === DAILY_LOGS_SYNC_FOLDER_NAME);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: DAILY_LOGS_SYNC_FOLDER_NAME,
    parent_folder_id: syncsFolder._id,
  });
  if (!created) throw new Error("Failed to create the project's syncs/Daily Logs folder");
  return created;
}

/** `${date}-${humanId}.md` — deterministic per (project, date, contributor),
 * so a re-run of the same day always resolves to the SAME file rather than
 * creating a duplicate (same "one card per project per day" idempotency
 * property `createDailyLogCard` establishes at the source). Includes
 * `humanId` (not just `date`) because a project can have Cards from
 * several different contributors on the same day — see the `vault` skill's
 * Sharing Roles section. */
function syncedCardFileName(date: string, humanId: string): string {
  return `${date}-${humanId}.md`;
}

/** The reverse of `syncedCardFileName` — recovers `{date, humanId}` from a
 * synced Card copy's own filename, for `sync-graph` (`syncGraph.server.ts`)
 * to resolve WHO actually contributed a candidate's content (the file's
 * own `human_id` is always the PROJECT's owner, since the synced copy
 * lives in the project's own vault, not the contributor's). Relies on a
 * SurrealDB-generated human id never containing a hyphen (true for every
 * id this app has ever generated) to unambiguously split `date` from
 * `humanId` — returns `null` for anything that doesn't match this exact
 * shape (any other file under `syncs/`, including a future non-daily-log
 * sync source's own naming, which has no reason to follow this
 * convention at all). */
export function parseSyncedCardFileName(name: string): { date: string; humanId: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})-([^-]+)\.md$/.exec(name);
  if (!match) return null;
  return { date: match[1], humanId: match[2] };
}

/** Deterministic name for a Card attachment once copied into
 * `syncs/Daily Logs/` — prefixed with the same `${date}-${humanId}` the
 * Card's own copy uses, so two different days' (or contributors')
 * same-named attachments never collide, and a re-run can check "does this
 * exact name already exist" instead of re-deriving provenance some other
 * way. */
function syncedAttachmentFileName(date: string, humanId: string, originalName: string): string {
  return `${date}-${humanId}-${originalName}`;
}

export type DailyLogSyncResult = {
  /** A Card whose content was newly written or updated this run. */
  synced: { date: string; humanId: string; fileId: string }[];
  /** A Card that already had an up-to-date copy — no write needed. */
  unchanged: { date: string; humanId: string }[];
  /** A Card attachment copied in for the first time this run. */
  attachmentsCopied: { date: string; humanId: string; fileId: string; name: string }[];
};

/**
 * Runs daily-log-sync for one project: every (day, contributor) with a Card
 * for this project (optionally narrowed to one `date`, or a `since`/`until`
 * range) gets its Card content mirrored into `syncs/Daily Logs/`, and every
 * `::file{...}` attachment referenced in that Card gets copied alongside it
 * (so sync-knowledge's later walk of the `syncs/` tree sees them too — see
 * the `graphlog` skill). Idempotent: an unchanged Card is skipped entirely
 * (via a stored `content_hash`, the same field `fileSnapshot`/pre-capture
 * already rely on elsewhere), and an already-copied attachment is
 * recognized by its deterministic destination name, never copied twice.
 *
 * Cross-human by design, same as PhyLog's pre-capture/capture —
 * `listCardEntriesForProject` already sweeps every contributor's Cards for
 * this project, not just whoever triggers the run.
 */
export async function runDailyLogSync(
  projectFolderId: string,
  { date, since, until }: { date?: string; since?: string; until?: string } = {},
): Promise<DailyLogSyncResult> {
  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) throw new Error("Project folder not found");

  const dailyLogsFolder = await ensureDailyLogsSyncFolder(projectFolder);
  const { files: existingFiles } = await listFolderChildren(
    projectFolder.human_id,
    dailyLogsFolder._id,
  );
  const existingFileByName = new Map(existingFiles.map((f) => [f.name, f]));
  // Attachment existence only ever needs a plain name check (never a hash
  // comparison — see `syncedAttachmentFileName`'s own doc), tracked
  // separately so a just-copied attachment can be recorded without needing
  // a full `FileRefListing`-shaped object to put in `existingFileByName`.
  const attachmentNamesHandled = new Set(existingFiles.map((f) => f.name));

  const range = date ? { since: date, until: date } : { since, until };
  const entries = await listCardEntriesForProject(projectFolderId, range);

  const result: DailyLogSyncResult = { synced: [], unchanged: [], attachmentsCopied: [] };

  for (const { humanId, date: entryDate } of entries) {
    const cards = await getDailyLogCards(humanId, entryDate);
    const card = cards.find((c) => c.projectFolderId === projectFolderId);
    if (!card) continue; // Card was deleted out from under an earlier listing — skip, not an error.

    const targetName = syncedCardFileName(entryDate, humanId);
    const hash = contentHash(card.content);
    const existingFile = existingFileByName.get(targetName);

    if (existingFile && existingFile.content_hash === hash) {
      result.unchanged.push({ date: entryDate, humanId });
    } else if (existingFile) {
      await updateFileRef(existingFile._id, { content: card.content, content_hash: hash });
      result.synced.push({ date: entryDate, humanId, fileId: existingFile._id });
    } else {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: targetName,
        content: card.content,
        content_type: "text/markdown",
        content_hash: hash,
        folder_id: dailyLogsFolder._id,
        // Stamped so `sync-graph` (`syncGraph.server.ts`) can group
        // candidates by day generically (reading this field), rather than
        // re-parsing it back out of `targetName`'s own convention.
        date: entryDate,
      });
      if (created) {
        result.synced.push({ date: entryDate, humanId, fileId: created._id });
      }
    }

    for (const attachment of extractFileAttachments(card.content)) {
      const attachmentName = syncedAttachmentFileName(entryDate, humanId, attachment.name);
      if (attachmentNamesHandled.has(attachmentName)) continue; // already synced in a previous run

      const copied = await copyFileIntoFolder(attachment.fileId, dailyLogsFolder._id);
      if (!copied) continue; // source file vanished mid-flight

      // `copyFileIntoFolder` auto-dedupes against the SOURCE's own filename
      // (see its own doc) — rename to our deterministic name right after,
      // so a re-run's existence check above stays reliable.
      if (copied.name !== attachmentName) {
        await updateFileRef(copied._id, { name: attachmentName });
      }
      attachmentNamesHandled.add(attachmentName);
      result.attachmentsCopied.push({
        date: entryDate,
        humanId,
        fileId: copied._id,
        name: attachmentName,
      });
    }
  }

  return result;
}
