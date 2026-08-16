/**
 * `project-n01` — the space type every `projects/<name>` folder AND the
 * `personal` root itself now carry (see the `vault` skill and
 * `vaultFolderTypes.ts`'s "Container types" doc). This file owns:
 *
 *   - The DEFAULT `skills/PRE_CAPTURE.md` / `CAPTURE.md` / `POST_CAPTURE.md`
 *     content every `project-n01` gets seeded with, and the seeding logic
 *     itself (`ensureProjectN01`) — called both at CREATION time (a brand
 *     new project, or the `personal` root the first time a vault is
 *     provisioned) and LAZILY, as a self-healing retrofit for any
 *     project/personal folder that predates this type (same "backfill on
 *     next touch" convention `ensureVaultRootFolders` already established
 *     for root folders).
 *   - `resetProjectN01Content` — the "delete everything PhyLog manages and
 *     start over" operation `nopal phylog reset`/`reset-pre-capture`
 *     call. Deletes every direct child of a `project-n01` folder EXCEPT
 *     its `skills`/`syncs`/`newspapers` anchors (the only human-writable
 *     parts) and, unless `wipeDailyLogs` is passed, `daily-logs` too
 *     (pre-capture's own reusable output — see below). Clears out this
 *     project's own Release Log history either way (see its own doc below
 *     for why that's required, not optional).
 *   - The `daily-logs` space's own find/create/list/manifest helpers
 *     (`ensureProjectDailyLogsFolder`, `getOrCreateDailyLogEntryFolder`,
 *     `listDailyLogEntries`, `writeDailyLogEntryMeta`) — pre-capture's own
 *     staging area, one subfolder per (day, contributor), that capture
 *     then reads to decide how to organize the project. See the `phylog`
 *     skill's pipeline section for the full data flow.
 *
 * PhyLog's pre-capture/capture/post-capture stages (`preCapture.server.ts`,
 * `capture.server.ts`, `postCapture.server.ts`) read the three skill files
 * this module seeds — see the `phylog` skill for the full pipeline design.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createFileRef,
  createVaultFolder,
  deleteFileRef,
  deleteVaultFolderCascade,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { merge } from "./generic.server";
import { splitFrontmatter, withReadmeBody } from "./project.types";

// ─── Default skill file content ────────────────────────────────────────

/** The exact marker a skill file's body must START WITH (after any front
 * matter) to mean "do nothing" — checked case-insensitively against the
 * first non-blank line. Shared by all three stages. */
const SKIP_MARKER = "skip";

export const DEFAULT_PRE_CAPTURE_SKILL = `${SKIP_MARKER}

PhyLog's pre-capture stage does nothing until you replace this with real
instructions. When it runs, it looks at every file attached to this
project's daily-log Cards, and every file inside this project's own
\`syncs/\` folder, that doesn't already have a sibling \`*-summary.md\` next
to it — and asks an AI to decide (per the instructions you write here)
whether to write one, and what it should focus on.

For example, you might replace this with something like:

- Describe every photo attachment factually — what it shows, not what it
  means.
- Summarize any PDF or text file dropped into syncs/ in 2-3 sentences.
- Skip anything that's just a screenshot of a chat.

Leaving this file as "skip" means pre-capture is a complete no-op — capture
will still run, it just won't have any pre-written summaries to draw on.
`;

export const DEFAULT_CAPTURE_SKILL = `File every new attachment from this project's daily-log Cards into this
project, and keep README.md as a clear, organized index linking to
everything that's been filed. Reorganize into subfolders only when it
clearly helps keep things navigable — don't create structure for its own
sake. Never invent progress, dates, or facts that aren't grounded in the
Card content, any pre-capture summaries, or README.md's own existing
content.

When presenting a GROUP of related photos, use the ::gallery{folder="..."}
directive (group them into a single subfolder, then reference it by name)
so they display as a photo grid instead of a bulleted list of links.

Replace this file with your own instructions to change how this project
gets organized — e.g. "group photos by month" or "keep a running task
list at the top of the README."
`;

export const DEFAULT_POST_CAPTURE_SKILL = `${SKIP_MARKER}

Post-capture is reserved for processing that happens after this project's
structure and README have already been captured — for example, the
planned "newspapers" space (a generated daily/individual digest). Nothing
runs here yet; replace this file once there's something you want done
after every capture.
`;

/** True when `content`'s body (front matter already stripped by the
 * caller, if any) means "do nothing" for a given stage — the first
 * non-blank line is exactly "skip", case-insensitive. Missing/empty
 * content is ALSO treated as skip (no skill file = nothing to do), same
 * "absence means off" convention the rest of PhyLog uses. */
export function isSkipInstruction(content: string | null | undefined): boolean {
  if (!content) return true;
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return (firstLine?.trim().toLowerCase() ?? "") === SKIP_MARKER;
}

// ─── Seeding ────────────────────────────────────────────────────────────

async function ensureSkillFile(
  humanId: string,
  skillsFolderId: string,
  name: string,
  defaultContent: string,
): Promise<void> {
  const { files } = await listFolderChildren(humanId, skillsFolderId);
  if (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
  await createFileRef({
    human_id: humanId,
    name,
    content: defaultContent,
    content_type: "text/markdown",
    folder_id: skillsFolderId,
  });
}

/**
 * Idempotently ensures `folder` (a project, or the `personal` root) is
 * tagged `project-n01` and has a `skills` folder seeded with the three
 * default stage skill files — safe to call on every access (a no-op once
 * everything already exists). Returns the up-to-date folder record.
 */
export async function ensureProjectN01(folder: VaultFolder): Promise<VaultFolder> {
  let current = folder;
  if (current.folder_type !== "project-n01" || !current.is_folder_type_root) {
    const updated = await merge("vault_folders", current._id, {
      folder_type: "project-n01",
      is_folder_type_root: true,
      updated_at: new Date().toISOString(),
    });
    if (updated) current = await getFolderById(current._id) ?? current;
  }

  const { folders } = await listFolderChildren(current.human_id, current._id);
  let skillsFolder = folders.find(
    (f) => f.is_folder_type_root && f.folder_type === "skills",
  );
  if (!skillsFolder) {
    skillsFolder = await createVaultFolder({
      human_id: current.human_id,
      name: "Skills",
      parent_folder_id: current._id,
      folder_type: "skills",
    });
  }
  if (skillsFolder) {
    await Promise.all([
      ensureSkillFile(current.human_id, skillsFolder._id, "PRE_CAPTURE.md", DEFAULT_PRE_CAPTURE_SKILL),
      ensureSkillFile(current.human_id, skillsFolder._id, "CAPTURE.md", DEFAULT_CAPTURE_SKILL),
      ensureSkillFile(current.human_id, skillsFolder._id, "POST_CAPTURE.md", DEFAULT_POST_CAPTURE_SKILL),
    ]);
  }

  return current;
}

/**
 * Resolves `folderId`, verifies it's actually a `project-n01` folder (a
 * project, or `personal`), and retrofits it (stamping the type + seeding
 * default skills) if it predates this type. This is the chokepoint every
 * PhyLog CLI/API entry point runs a `--project` path through before doing
 * any real work, so no caller needs to remember to backfill.
 */
export async function resolveProjectN01(
  folderId: string,
): Promise<{ ok: true; folder: VaultFolder } | { ok: false; error: string }> {
  const folder = await getFolderById(folderId);
  if (!folder) return { ok: false, error: "Folder not found" };

  const isPersonalRoot = !folder.parent_folder_id && folder.vault_root_key === "personal";
  let isProjectFolder = false;
  if (!isPersonalRoot && folder.parent_folder_id) {
    const parent = await getFolderById(folder.parent_folder_id);
    isProjectFolder = !!parent && !parent.parent_folder_id && parent.vault_root_key === "projects";
  }
  const alreadyTagged = folder.folder_type === "project-n01" && folder.is_folder_type_root;

  if (!isPersonalRoot && !isProjectFolder && !alreadyTagged) {
    return {
      ok: false,
      error: "This isn't a project — pass a path like 'projects/sunny' or 'personal'",
    };
  }

  return { ok: true, folder: await ensureProjectN01(folder) };
}

// ─── Daily Logs space (pre-capture's own output) ─────────────────
// A project's `daily-logs` folder type (`vaultFolderTypes.ts`) is a
// staging area, one subfolder per (day, contributor), holding a copy of
// that day's Card content plus any generated summaries -- see the
// `phylog` skill's "Stage 1 -- pre-capture" section. NOT the same thing
// as the vault-wide `daily-logs` ROOT (a completely separate concept that
// happens to share the name) -- this one lives INSIDE a single project.
//
// Lookup is by MANIFEST (`_meta.md` front matter), never by folder name
// alone -- a folder's name is a human-readable label (`YYYY-MM-DD-name`),
// not a stable key, so a display-name change or a name collision between
// two contributors never breaks idempotency.

/** The manifest file every daily-logs entry folder carries -- front
 * matter only, `parseDailyLogEntryMeta` reads it back. Leading
 * underscore sorts it first in any listing and signals "system file,
 * don't hand-edit". */
export const DAILY_LOG_ENTRY_META_FILE = "_meta.md";

/** The plain-text copy of that day's Card content pre-capture keeps
 * current inside every entry folder -- capture reads THIS (not the
 * original Card, and not the human's own vault at all) as "the day's
 * content" for its organize/README agent loop. */
export const CARD_COPY_FILE = "card.md";

export type DailyLogEntryMeta = {
  humanId: string;
  humanName: string;
  date: string;
  /** The originating Card's own fileId -- kept for traceability, not
   * itself the idempotency key (see `sourceHash`). */
  cardFileId: string;
  /** A content hash covering the Card's own text plus its attachment
   * list, refreshed by pre-capture every run -- `capture.server.ts` uses
   * `${entryFolderId}:${sourceHash}` as its own Release Log `source_ref`,
   * the same "idempotent against a hash of what changed" convention the
   * rest of PhyLog already uses. */
  sourceHash: string;
  updatedAt: string;
  /** Set by CAPTURE (never pre-capture) when it looked at this entry and
   * genuinely decided nothing needed to change -- a real decision, not
   * an error/refusal/truncation (those are deliberately NEVER recorded
   * here, so they keep retrying on the next run -- see capture.server.ts's
   * own doc). Equal to `sourceHash` at the moment that decision was made;
   * `runCapture`'s own skip check treats `capturedNoOpSourceHash ===
   * sourceHash` the same as an applied Release Log entry. Without this,
   * a day with nothing to say would never be recorded ANYWHERE (no
   * Release Log entry either, since nothing changed) and would get a
   * fresh, wasted LLM call on every single future run forever -- a real,
   * confirmed bug this fixes. Preserved automatically by
   * `writeDailyLogEntryMeta` across pre-capture's own routine refreshes
   * (which never set this field themselves) as long as `sourceHash`
   * hasn't changed; a genuinely new/changed entry naturally stops
   * matching and gets a fresh look. */
  capturedNoOpSourceHash?: string;
  /** The COUNTERPART to `capturedNoOpSourceHash` above, for when a real
   * change WAS applied (a Release Log entry got created) rather than a
   * no-op. Set by `runCapture` right after that happens, equal to
   * `sourceHash` at that moment. Exists purely as a FAST PATH: without
   * it, confirming "was this entry already applied" means a
   * `findReleaseLogEntryBySource` database round trip for every single
   * already-settled historical entry, on every single incremental run,
   * forever -- the real cost behind capture feeling slow on a project
   * with a long history, since the vast majority of entries on any given
   * run are ones that will never need to be looked at again.
   * `runCapture`'s skip check tries this in-memory comparison FIRST
   * (`capturedAppliedSourceHash === sourceHash`, no I/O at all beyond
   * what `listDailyLogEntries` already fetched) and only falls back to
   * the database check for an entry that doesn't have it set yet -- at
   * which point, if that slower check finds a real applied entry after
   * all (e.g. one processed before this field existed), it backfills
   * this field so every FUTURE run hits the fast path instead. Preserved
   * across pre-capture's own routine `_meta.md` rewrites the same way
   * `capturedNoOpSourceHash` is. */
  capturedAppliedSourceHash?: string;
};

export type DailyLogEntry = { folder: VaultFolder; meta: DailyLogEntryMeta };

function slugifyForFolderName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "human";
}

function parseDailyLogEntryMeta(content: string | null | undefined): DailyLogEntryMeta | null {
  if (!content) return null;
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return null;
  try {
    const data = parseYaml(frontmatter) as Record<string, unknown> | null;
    if (!data || typeof data.humanId !== "string" || typeof data.date !== "string") return null;
    return {
      humanId: data.humanId,
      humanName: typeof data.humanName === "string" ? data.humanName : data.humanId,
      date: data.date,
      cardFileId: typeof data.cardFileId === "string" ? data.cardFileId : "",
      sourceHash: typeof data.sourceHash === "string" ? data.sourceHash : "",
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      capturedNoOpSourceHash: typeof data.capturedNoOpSourceHash === "string" ? data.capturedNoOpSourceHash : undefined,
      capturedAppliedSourceHash: typeof data.capturedAppliedSourceHash === "string" ? data.capturedAppliedSourceHash : undefined,
    };
  } catch {
    return null;
  }
}

async function findProjectDailyLogsFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  return folders.find((f) => f.is_folder_type_root && f.folder_type === "daily-logs") ?? null;
}

/** Idempotently ensures the project's `daily-logs` space folder exists --
 * unlike `skills`, NOT auto-seeded at project creation; pre-capture calls
 * this lazily, the first time it actually has something to write. */
export async function ensureProjectDailyLogsFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const existing = await findProjectDailyLogsFolder(projectFolder);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: "Daily Logs",
    parent_folder_id: projectFolder._id,
    folder_type: "daily-logs",
  });
  if (!created) throw new Error("Failed to create the project's daily-logs folder");
  return created;
}

/** Every (day, contributor) entry already staged for this project, oldest
 * first (then humanId, for a deterministic tie-break) -- same ordering
 * convention `dailyLog.server.ts`'s `listCardEntriesForProject` uses.
 * Read-only: never creates the `daily-logs` folder itself, so a project
 * that's never had pre-capture run on it just resolves to an empty list. */
export async function listDailyLogEntries(projectFolder: VaultFolder): Promise<DailyLogEntry[]> {
  const dailyLogsFolder = await findProjectDailyLogsFolder(projectFolder);
  if (!dailyLogsFolder) return [];
  const { folders } = await listFolderChildren(projectFolder.human_id, dailyLogsFolder._id);
  // PARALLEL, not sequential -- each candidate folder's own lookup is
  // fully independent (a read, no shared mutable state), so awaiting
  // them one at a time here just serializes M round trips' worth of
  // network latency for no reason. See `findDailyLogEntry`'s own doc for
  // the OTHER half of this fix (avoiding calling this whole function
  // once PER CARD in a sweep).
  const resolved = await Promise.all(
    folders.map(async (candidate): Promise<DailyLogEntry | null> => {
      const { files } = await listFolderChildren(projectFolder.human_id, candidate._id);
      const metaListing = files.find((f) => f.name === DAILY_LOG_ENTRY_META_FILE);
      if (!metaListing) return null;
      const metaFile = await getFileRefById(metaListing._id);
      const meta = parseDailyLogEntryMeta(metaFile?.content);
      return meta ? { folder: candidate, meta } : null;
    }),
  );
  const entries = resolved.filter((e): e is DailyLogEntry => e !== null);
  entries.sort(
    (a, b) => a.meta.date.localeCompare(b.meta.date) || a.meta.humanId.localeCompare(b.meta.humanId),
  );
  return entries;
}

/** Pure lookup against an ALREADY-FETCHED entries list -- no I/O.
 * Callers processing MANY entries in one run (e.g.
 * `preCapture.server.ts`'s own sweep) should fetch `listDailyLogEntries`
 * ONCE up front and use this per individual lookup, rather than calling
 * `getOrCreateDailyLogEntryFolder` in a loop -- that would otherwise
 * re-run the ENTIRE `listDailyLogEntries` scan on every single Card, an
 * O(cards * entries) blowup that gets genuinely slow once a project has
 * real history (confirmed: this was a real, shipped perf bug, not just a
 * theoretical one -- fixed by this split). */
export function findDailyLogEntry(
  entries: DailyLogEntry[],
  humanId: string,
  date: string,
): DailyLogEntry | undefined {
  return entries.find((e) => e.meta.humanId === humanId && e.meta.date === date);
}

/** Creates a fresh entry folder for a (humanId, date) pair a caller has
 * ALREADY confirmed (via `findDailyLogEntry` against an already-fetched
 * list) doesn't exist yet -- skips `getOrCreateDailyLogEntryFolder`'s own
 * internal re-fetch. Named `YYYY-MM-DD-<slug of humanName>`
 * (de-duplicated against sibling NAMES only when actually necessary --
 * the manifest, not the name, is what lookup relies on). Implicitly
 * ensures the `daily-logs` folder itself exists. */
export async function createDailyLogEntryFolder(
  projectFolder: VaultFolder,
  input: { humanId: string; humanName: string; date: string },
): Promise<VaultFolder> {
  const dailyLogsFolder = await ensureProjectDailyLogsFolder(projectFolder);
  const { folders: siblings } = await listFolderChildren(projectFolder.human_id, dailyLogsFolder._id);
  const baseName = `${input.date}-${slugifyForFolderName(input.humanName)}`;
  const existingNames = new Set(siblings.map((f) => f.name));
  let name = baseName;
  let n = 2;
  while (existingNames.has(name)) name = `${baseName}-${n++}`;

  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name,
    parent_folder_id: dailyLogsFolder._id,
  });
  if (!created) throw new Error("Failed to create a daily-logs entry folder");
  return created;
}

/** Convenience wrapper for a caller handling just ONE (humanId, date)
 * lookup (or that doesn't already have a fetched list) -- fetches fresh,
 * then finds-or-creates. Callers processing MANY entries in one run
 * (pre-capture's own sweep) should fetch `listDailyLogEntries` ONCE and
 * use `findDailyLogEntry`/`createDailyLogEntryFolder` directly instead --
 * see those functions' own docs for why. */
export async function getOrCreateDailyLogEntryFolder(
  projectFolder: VaultFolder,
  input: { humanId: string; humanName: string; date: string; cardFileId: string },
): Promise<{ folder: VaultFolder; meta: DailyLogEntryMeta | null }> {
  const existingEntries = await listDailyLogEntries(projectFolder);
  const match = findDailyLogEntry(existingEntries, input.humanId, input.date);
  if (match) return match;
  const folder = await createDailyLogEntryFolder(projectFolder, input);
  return { folder, meta: null };
}

/** Writes (or refreshes) an entry folder's own `_meta.md` -- the ONLY
 * thing capture's own idempotency check and `listDailyLogEntries`'s
 * lookup actually trust. Call this every time pre-capture finishes
 * syncing an entry folder's content, even when nothing changed (cheap: a
 * plain content overwrite, no version snapshotting needed for a
 * system-managed manifest). */
export async function writeDailyLogEntryMeta(
  entryFolder: VaultFolder,
  meta: DailyLogEntryMeta,
): Promise<void> {
  const { files } = await listFolderChildren(entryFolder.human_id, entryFolder._id);
  const existing = files.find((f) => f.name === DAILY_LOG_ENTRY_META_FILE);

  // `capturedNoOpSourceHash`/`capturedAppliedSourceHash` are only ever SET
  // by capture, never by pre-capture -- if this call's own `meta` doesn't
  // specify either (pre-capture's routine refreshes never do), carry
  // forward whatever was already on disk rather than silently dropping
  // it. This is what lets a pre-capture re-run (which always rebuilds
  // `meta` from scratch) leave capture's own memory of this entry intact.
  const existingFile = existing ? await getFileRefById(existing._id) : undefined;
  const existingMeta = parseDailyLogEntryMeta(existingFile?.content);
  const capturedNoOpSourceHash = meta.capturedNoOpSourceHash ?? existingMeta?.capturedNoOpSourceHash;
  const capturedAppliedSourceHash = meta.capturedAppliedSourceHash ?? existingMeta?.capturedAppliedSourceHash;

  const frontmatter = stringifyYaml({
    humanId: meta.humanId,
    humanName: meta.humanName,
    date: meta.date,
    cardFileId: meta.cardFileId,
    sourceHash: meta.sourceHash,
    updatedAt: meta.updatedAt,
    ...(capturedNoOpSourceHash ? { capturedNoOpSourceHash } : {}),
    ...(capturedAppliedSourceHash ? { capturedAppliedSourceHash } : {}),
  }).trimEnd();
  const content = `---\n${frontmatter}\n---\n\nPre-processed daily log for ${meta.humanName} on ${meta.date}. Managed by PhyLog's pre-capture stage -- do not edit by hand.\n`;

  if (existing) {
    await updateFileRef(existing._id, { content });
  } else {
    await createFileRef({
      human_id: entryFolder.human_id,
      name: DAILY_LOG_ENTRY_META_FILE,
      content,
      content_type: "text/markdown",
      folder_id: entryFolder._id,
    });
  }
}

// ─── Reset ──────────────────────────────────────────────────────
// TWO DISTINCT reset depths, per the `phylog` skill's own "Reset" section:
//
//   - `nopal phylog reset` (`wipeDailyLogs: false`, the default) leaves
//     `skills`/`syncs`/`daily-logs` alone — `daily-logs` already holds
//     pre-capture's own staged output, so a plain `capture --full`
//     afterward can rebuild the whole project straight from what's
//     already there, with NO need to re-run pre-capture (no new LLM
//     calls for summaries that haven't changed).
//   - `nopal phylog reset-pre-capture` (`wipeDailyLogs: true`) ALSO
//     wipes `daily-logs` — the deeper "start completely over" reset,
//     needed when pre-capture's own output itself should be regenerated
//     (e.g. after editing `skills/PRE_CAPTURE.md`). Requires `nopal
//     phylog pre-capture` (to restage `daily-logs`) before `capture
//     --full` has anything to rebuild from again.

/** Folder types that survive an ORDINARY reset — the human-writable parts
 * of a `project-n01` folder (`skills`/`syncs`), plus `daily-logs`
 * (system-managed, but deliberately preserved so `capture --full` alone
 * can rebuild from it — see above). `resetProjectN01Content`'s own
 * `wipeDailyLogs` option removes `daily-logs` from this set for the
 * deeper `reset-pre-capture` case. */
const SURVIVES_RESET = new Set(["skills", "syncs", "newspapers", "daily-logs"]);

export type ResetSummary = {
  deletedFolders: string[];
  deletedFiles: string[];
};

/**
 * Deletes every direct child of a `project-n01` folder EXCEPT its
 * `skills`/`syncs`/`newspapers`/`daily-logs` anchors (and everything
 * nested under them) — the "everything else is disposable,
 * PhyLog-managed" rule the `vault` skill defines. Pass `wipeDailyLogs:
 * true` to ALSO delete `daily-logs` (the `reset-pre-capture` case
 * above) — default `false` keeps it, since it's pre-capture's own
 * reusable output, not throwaway organize/README state. Also clears this
 * project's own Release Log history (`release_log_entries`/
 * `release_log_changesets`) either way: those rows describe state (which
 * files got filed, what the README used to say, which `daily-logs` entry
 * was already captured) that this reset just invalidated, so leaving them
 * behind would make a subsequent `capture --full` think everything was
 * already applied and silently skip re-processing it. Regenerates both
 * release-log.md reflections (now empty) afterward.
 *
 * **`README.md` is NEVER deleted outright — only its BODY is cleared,
 * with its front matter preserved byte-for-byte (`withReadmeBody`,
 * `project.types.ts`).** A real, confirmed bug this fixes: README's front
 * matter is the ONLY place a project's Sharing Roles (`sharing`, see
 * `projectSharing.server.ts`) and lifecycle `status`
 * (`projectStatus.server.ts`) are stored — deleting the file outright
 * silently revoked every collaborator's role (and reset the project's
 * status) on every `phylog reset`/`reset-pre-capture`/`capture --full`,
 * even though NEITHER of those fields is PhyLog-generated, disposable
 * content the way the README's BODY is. Preserving front matter here
 * costs nothing else: `captureOneDay` already merges a fresh body into
 * whatever front matter is already there via this same `withReadmeBody`
 * helper, so a later capture run rebuilds correctly on top of it. Not
 * counted in `deletedFiles` below — the file's own identity/metadata
 * survives, only its generated content was cleared.
 *
 * Deliberately NOT run automatically by `capture --full` on its own
 * schedule — always an explicit, separate call (`nopal phylog reset`/
 * `reset-pre-capture`), so a human can inspect the emptied-out state
 * before re-running capture.
 */
export async function resetProjectN01Content(
  folder: VaultFolder,
  opts: { wipeDailyLogs?: boolean } = {},
): Promise<ResetSummary> {
  const survives = opts.wipeDailyLogs
    ? new Set([...SURVIVES_RESET].filter((t) => t !== "daily-logs"))
    : SURVIVES_RESET;
  return resetProjectN01ContentInternal(folder, survives);
}

async function resetProjectN01ContentInternal(
  folder: VaultFolder,
  survives: Set<string>,
): Promise<ResetSummary> {
  const { folders, files } = await listFolderChildren(folder.human_id, folder._id);
  const summary: ResetSummary = { deletedFolders: [], deletedFiles: [] };

  for (const child of folders) {
    if (child.is_folder_type_root && survives.has(child.folder_type ?? "")) continue;
    await deleteVaultFolderCascade(child._id);
    summary.deletedFolders.push(child.name);
  }
  for (const file of files) {
    if (file.name.toLowerCase() === "readme.md") {
      // `listFolderChildren` only returns lightweight listings (no
      // `content`) -- need the full record to read/preserve its front
      // matter.
      const full = await getFileRefById(file._id);
      const currentContent = full?.content ?? "";
      const blanked = withReadmeBody(currentContent, "");
      if (full && blanked !== currentContent) {
        await updateFileRef(file._id, { content: blanked });
      }
      continue;
    }
    await deleteFileRef(file._id);
    summary.deletedFiles.push(file.name);
  }

  const { clearReleaseLogForProject } = await import("./releaseLog.server");
  await clearReleaseLogForProject(folder._id);

  return summary;
}

/** Reads a project-n01's `skills/<name>` file content, or null if it (or
 * the skills folder itself) doesn't exist — malformed/missing is always
 * treated as "no instructions", never a hard failure. Shared by all three
 * pipeline stages. */
export async function getProjectStageSkill(
  projectFolder: { human_id: string; _id: string },
  name: string,
): Promise<string | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) return null;
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);
  const listing = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (!listing) return null;
  const file = await getFileRefById(listing._id);
  return file?.content ?? null;
}

/** The four skill file names every pipeline stage already fetches by
 * name (`getProjectStageSkill`) -- excluded from `listExtraSkillFiles`
 * below so a reference file never gets folded into a prompt twice. */
const RESERVED_SKILL_FILE_NAMES = new Set(["pre_capture.md", "capture.md", "post_capture.md", "skill.md"]);

/** Any OTHER file a project owner drops into `skills/` -- e.g. a
 * VOICE.md a CAPTURE.md says to "read and follow". Auto-folded into
 * every stage's prompt (see `capture.server.ts`/`preCapture.server.ts`)
 * alongside SKILL.md's own general steering, never gated behind a tool
 * call a model might skip -- if it's in `skills/`, it's read. Sorted by
 * name for stable prompts across runs. */
export async function listExtraSkillFiles(
  projectFolder: { human_id: string; _id: string },
): Promise<{ name: string; content: string }[]> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) return [];
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);
  const extras = files.filter((f) => !RESERVED_SKILL_FILE_NAMES.has(f.name.toLowerCase()));
  const withContent = await Promise.all(
    extras.map(async (f) => {
      const file = await getFileRefById(f._id);
      return { name: f.name, content: (file?.content ?? "").trim() };
    }),
  );
  return withContent.filter((f) => f.content.length > 0).sort((a, b) => a.name.localeCompare(b.name));
}
