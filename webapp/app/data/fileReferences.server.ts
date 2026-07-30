/**
 * File Referencing & Renaming — a `file_references` index of every
 * `@mention` link and project-rollup directive attribute (`::name{file=...}`
 * / `::name{folder=...}`) found in any markdown file's content, so renaming
 * or moving a file/folder can find and fix every place it's referenced in
 * O(references-to-that-target) instead of scanning the whole vault.
 *
 * Two reference KINDS are tracked (see the `vault` skill's "File
 * Referencing & Renaming" section):
 *
 *   - `"mention"` — an `@`-mention link (`[@Name](/humanId:path/to/target)`,
 *     see `oxmarkdown/mention.ts`). Deliberately kept in its shipped,
 *     human-readable-path form (not switched to opaque IDs) — this table
 *     is what makes a targeted rewrite of that path cheap when the target
 *     renames/moves, without needing to change the saved markdown format.
 *   - `"directive-attr"` — a `file="..."`/`folder="..."` attribute on any
 *     leaf directive (`::csv-table{file=...}`, `::gallery{folder=...}`,
 *     ...) EXCEPT the built-in `file`/`card` directives, which already
 *     reference by stable id (`fileId`/`projectFolderId`) and need no
 *     propagation at all. Resolved against the attribute's OWN containing
 *     folder's direct children by name, mirroring exactly how
 *     `project.server.ts`'s `resolveProjectManifest` already resolves them
 *     for rendering.
 *
 * `@mention`s can point at content in ANOTHER human's vault (now that
 * Sharing Roles make cross-human project access real) — resolution/rewrite
 * always operates on the REFERRER's own file, so this never needs write
 * access to the target's owner's vault, only read access to resolve
 * current names.
 *
 * Deliberately ID-only in the table itself (`target_type`/`target_id`) —
 * `ref_text` is a CACHE of the exact raw text currently expressing the
 * reference (captured fresh on every save via `syncFileReferences`), used
 * only to relocate the right spot to rewrite; it's never treated as a
 * second source of truth for what's being referenced.
 */

import { query, upsert, formatRecord, defineTable, type Data } from "./generic.server";
import type { FileRef } from "./vault.types";
import {
  ensureVaultRootFolders,
  getDescendantFolders,
  getFileRefById,
  getFileRefsByFolderIds,
  getFolderAncestry,
  getFolderById,
  listFolderChildren,
  updateFileRef,
} from "./vault.server";
import { parseOxDocument } from "../oxmarkdown/document";
import {
  findLeafDirectiveOccurrences,
  replaceDirectiveAttrInMatch,
} from "../util/nopalDirectives";

export type ReferenceTargetType = "file" | "folder";
export type ReferenceKind = "mention" | "directive-attr";

export type FileReference = Data & {
  source_file_id: string;
  source_human_id: string;
  target_type: ReferenceTargetType;
  target_id: string;
  kind: ReferenceKind;
  /** The exact raw text currently expressing the reference — a mention's
   * whole `[@Name](path)` span, or a directive-attr's plain attribute
   * value (e.g. `"budget.csv"`). See the module doc for why this is a
   * cache, not a second source of truth. */
  ref_text: string;
  directive_name?: string | null;
  attr_name?: "file" | "folder" | null;
  created_at: string;
  updated_at: string;
};

export type TargetRef = { type: ReferenceTargetType; id: string };

/** SurrealDB only auto-creates a table on its first INSERT/UPSERT — a
 * `SELECT`/`DELETE` against `file_references` before this database has
 * ever written a row to it fails with "table does not exist" rather than
 * just returning zero rows. Every read/delete entry point below calls
 * this first; memoized per process so it's a real no-op after the first
 * call, not a query on every single one. */
let fileReferencesTableEnsured = false;
async function ensureFileReferencesTable(): Promise<void> {
  if (fileReferencesTableEnsured) return;
  await defineTable("file_references");
  fileReferencesTableEnsured = true;
}

// ─── Path resolution (name-based paths, same convention `@mention` uses) ───

/** Resolves a mention-style path (`root/segment/.../Name`, as produced by
 * `searchVaultEntries`/inserted via `oxmarkdown/mention.ts`) to the folder
 * or file it currently names — `null` if any segment doesn't match a real
 * child by name (already broken, or was never valid). Cross-human safe:
 * `humanId` here is whichever human's vault the mention's OWN path names,
 * not necessarily the referencing file's owner. */
export async function resolveVaultPath(
  humanId: string,
  rawPath: string,
): Promise<TargetRef | null> {
  const segments = rawPath
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  if (segments.length === 0) return null;

  const roots = await ensureVaultRootFolders(humanId);
  let current = roots.find((r) => r.name === segments[0]);
  if (!current) return null;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const { folders, files } = await listFolderChildren(humanId, current._id);
    const childFolder = folders.find((f) => f.name === seg);
    if (childFolder) {
      current = childFolder;
      continue;
    }
    if (isLast) {
      const file = files.find((f) => f.name === seg);
      if (file) return { type: "file", id: file._id };
    }
    return null;
  }
  return { type: "folder", id: current._id };
}

/** The inverse of `resolveVaultPath` — the CURRENT `/humanId:path` href and
 * display name for a target, freshly recomputed from today's folder/file
 * names and parentage. Used for both a rename AND a move (a move changes
 * the computed path just as much as a rename does — no separate code path
 * needed for either, see the `vault` skill). `null` if the target no
 * longer exists (the deletion path handles that separately). */
export async function computeCurrentMentionTarget(
  target: TargetRef,
): Promise<{ href: string; name: string } | null> {
  if (target.type === "folder") {
    const folder = await getFolderById(target.id);
    if (!folder) return null;
    const ancestry = await getFolderAncestry(target.id);
    const path = ancestry.map((f) => f.name).join("/");
    return { href: `/${folder.human_id}:${path}`, name: folder.name };
  }
  const file = await getFileRefById(target.id);
  if (!file || !file.folder_id) return null;
  const ancestry = await getFolderAncestry(file.folder_id);
  const path = [...ancestry.map((f) => f.name), file.name].join("/");
  return { href: `/${file.human_id}:${path}`, name: file.name };
}

// ─── Extraction (pure-ish — the only I/O is resolving each candidate) ──────

const MENTION_HREF_RE = /^\/([^:/]+):(.+)$/;

/** A minimal shape covering the mdast nodes this file walks — same
 * deliberately-loose convention `sorter.server.ts` already uses. */
type AnyNode = {
  type: string;
  children?: AnyNode[];
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function walk(node: AnyNode, visit: (node: AnyNode) => void): void {
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visit);
  }
}

type ExtractedReference = {
  target_type: ReferenceTargetType;
  target_id: string;
  kind: ReferenceKind;
  ref_text: string;
  directive_name?: string;
  attr_name?: "file" | "folder";
};

async function extractMentionReferences(
  content: string,
): Promise<ExtractedReference[]> {
  let doc;
  try {
    doc = parseOxDocument(content);
  } catch {
    // Unparseable content shouldn't ever block a save — just index nothing.
    return [];
  }

  const candidates: { url: string; start?: number; end?: number }[] = [];
  walk(doc as unknown as AnyNode, (node) => {
    if (node.type === "link" && typeof node.url === "string") {
      candidates.push({
        url: node.url,
        start: node.position?.start.offset,
        end: node.position?.end.offset,
      });
    }
  });

  const out: ExtractedReference[] = [];
  for (const candidate of candidates) {
    const match = MENTION_HREF_RE.exec(candidate.url);
    if (!match) continue;
    if (candidate.start === undefined || candidate.end === undefined) continue;
    const [, mentionedHumanId, rawPath] = match;
    const resolved = await resolveVaultPath(mentionedHumanId, rawPath);
    if (!resolved) continue; // already broken/unrecognized — nothing to track
    out.push({
      target_type: resolved.type,
      target_id: resolved.id,
      kind: "mention",
      ref_text: content.slice(candidate.start, candidate.end),
    });
  }
  return out;
}

/** Built-in leaf directives that already reference by stable id (`::file`'s
 * `fileId`, `::card`'s `projectFolderId`) — their OWN `file="..."` attribute
 * (a Card's deterministic `card-<projectFolderId>.md` filename, or in
 * `::file`'s case, not even present) is never a human-renameable reference
 * and must be excluded from the generic scan below. */
const BUILTIN_ID_BASED_DIRECTIVES = new Set(["file", "card"]);

async function extractDirectiveAttrReferences(
  sourceFile: Pick<FileRef, "human_id" | "folder_id">,
  content: string,
): Promise<ExtractedReference[]> {
  if (!sourceFile.folder_id) return [];
  const occurrences = findLeafDirectiveOccurrences(content).filter(
    (o) => !BUILTIN_ID_BASED_DIRECTIVES.has(o.name),
  );
  if (occurrences.length === 0) return [];

  const { folders, files } = await listFolderChildren(
    sourceFile.human_id,
    sourceFile.folder_id,
  );

  const out: ExtractedReference[] = [];
  for (const occ of occurrences) {
    for (const attrName of ["file", "folder"] as const) {
      const value = occ.attrs[attrName];
      if (!value) continue;
      const target =
        attrName === "file"
          ? files.find((f) => f.name === value)
          : folders.find((f) => f.name === value);
      if (!target) continue; // already broken/unresolvable — nothing to track
      out.push({
        target_type: attrName === "file" ? "file" : "folder",
        target_id: target._id,
        kind: "directive-attr",
        ref_text: value,
        directive_name: occ.name,
        attr_name: attrName,
      });
    }
  }
  return out;
}

// ─── Sync (the centralized hook `vault.server.ts` calls on every save) ─────

/** Only markdown content is ever scanned for references. */
function isReferenceTrackable(file: Pick<FileRef, "content_type">): boolean {
  return file.content_type === "text/markdown";
}

/**
 * Re-indexes `file`'s OWN outgoing references from scratch — delete
 * whatever was there, re-extract from the current content, re-insert.
 * Simple full-resync rather than a diff, same reasoning
 * `cascadeShareVaultFolder` already uses for its own wholesale overwrite:
 * per-file reference sets are small, and a diff buys nothing a resync
 * doesn't already give for free.
 *
 * Called from `vault.server.ts`'s `createFileRef`/`updateFileRef` (via a
 * dynamic import, to avoid a static circular import between the two
 * modules) — the single centralized choke point every markdown save
 * already passes through, so no individual route needs to remember to
 * call this itself.
 */
export async function syncFileReferences(file: FileRef): Promise<void> {
  await ensureFileReferencesTable();
  await query(`DELETE file_references WHERE source_file_id = $id`, {
    id: file._id,
  });

  if (!isReferenceTrackable(file) || file.content == null) return;

  const [mentions, directiveAttrs] = await Promise.all([
    extractMentionReferences(file.content),
    extractDirectiveAttrReferences(file, file.content),
  ]);

  const now = new Date().toISOString();
  for (const ref of [...mentions, ...directiveAttrs]) {
    await upsert("file_references", {
      source_file_id: file._id,
      source_human_id: file.human_id,
      target_type: ref.target_type,
      target_id: ref.target_id,
      kind: ref.kind,
      ref_text: ref.ref_text,
      directive_name: ref.directive_name ?? null,
      attr_name: ref.attr_name ?? null,
      created_at: now,
      updated_at: now,
    });
  }
}

// ─── Propagation (rename/move, and delete) ─────────────────────────────────

async function findReferencingRows(target: TargetRef): Promise<FileReference[]> {
  await ensureFileReferencesTable();
  const result = await query<[FileReference[]]>(
    `SELECT * FROM file_references WHERE target_type = $type AND target_id = $id`,
    { type: target.type, id: target.id },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Drops every OUTGOING reference row for a file that's about to be (or
 * has just been) deleted — the counterpart to `propagateTargetDeletion`,
 * which only ever cleans up INCOMING rows (`target_id = ...`). Exported
 * so `vault.server.ts`'s `deleteFileRef` doesn't need to know
 * `file_references`'s own schema/table-creation details. */
export async function dropOutgoingReferences(sourceFileId: string): Promise<void> {
  await ensureFileReferencesTable();
  await query(`DELETE file_references WHERE source_file_id = $id`, { id: sourceFileId });
}

function groupBySource<T extends { source_file_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.source_file_id);
    if (list) list.push(row);
    else map.set(row.source_file_id, [row]);
  }
  return map;
}

function rewriteDirectiveAttrOccurrences(
  content: string,
  directiveName: string,
  attrName: "file" | "folder",
  oldValue: string,
  newValue: string,
): string {
  const occurrences = findLeafDirectiveOccurrences(content).filter(
    (o) => o.name === directiveName && o.attrs[attrName] === oldValue,
  );
  if (occurrences.length === 0) return content;

  // Rewrite back-to-front so earlier occurrences' indices stay valid as
  // later ones are spliced in.
  let result = content;
  for (const occ of [...occurrences].sort((a, b) => b.index - a.index)) {
    const rewritten = replaceDirectiveAttrInMatch(occ.match, attrName, newValue);
    result =
      result.slice(0, occ.index) + rewritten + result.slice(occ.index + occ.match.length);
  }
  return result;
}

/**
 * The one propagation entry point for a rename OR a move (identical
 * handling — see `computeCurrentMentionTarget`'s own doc comment for why).
 * `targets` should include every folder/file whose computed PATH could
 * have changed — for a file rename/move that's just the file itself; for a
 * folder rename/move that's the folder AND every descendant folder/file
 * (their paths changed too, even though their own names didn't) — see
 * `collectFolderAndDescendantTargets`.
 */
export async function propagateTargetChange(targets: TargetRef[]): Promise<void> {
  if (targets.length === 0) return;

  const allRows: (FileReference & { _target: TargetRef })[] = [];
  for (const target of targets) {
    const rows = await findReferencingRows(target);
    for (const row of rows) allRows.push({ ...row, _target: target });
  }
  if (allRows.length === 0) return;

  const bySource = groupBySource(allRows);
  for (const [sourceFileId, refs] of bySource) {
    const source = await getFileRefById(sourceFileId);
    if (!source?.content) continue;
    let content = source.content;

    for (const ref of refs) {
      const fresh = await computeCurrentMentionTarget(ref._target);
      if (!fresh) continue; // handled by propagateTargetDeletion instead

      if (ref.kind === "mention") {
        const newSnippet = `[@${fresh.name}](${fresh.href})`;
        if (content.includes(ref.ref_text)) {
          content = content.split(ref.ref_text).join(newSnippet);
        }
      } else if (ref.attr_name && ref.directive_name) {
        content = rewriteDirectiveAttrOccurrences(
          content,
          ref.directive_name,
          ref.attr_name,
          ref.ref_text,
          fresh.name,
        );
      }
    }

    if (content !== source.content) {
      // Re-saving runs this same file's content back through
      // `updateFileRef` → `syncFileReferences`, so its OWN reference rows
      // (now pointing at the fresh path/value) are re-indexed for free.
      await updateFileRef(sourceFileId, { content });
    }
  }
}

/**
 * Every folder/file whose computed mention PATH would change if `folderId`
 * were renamed or moved — itself, plus every descendant folder and file.
 */
export async function collectFolderAndDescendantTargets(
  folderId: string,
): Promise<TargetRef[]> {
  const descendantFolders = await getDescendantFolders(folderId);
  const allFolderIds = [folderId, ...descendantFolders.map((f) => f._id)];
  const files = await getFileRefsByFolderIds(allFolderIds);
  return [
    ...allFolderIds.map((id): TargetRef => ({ type: "folder", id })),
    ...files.map((f): TargetRef => ({ type: "file", id: f._id })),
  ];
}

/**
 * Called when `target` is about to be permanently deleted (or has just
 * been — see call sites in `vault.server.ts`). A mention gets its LABEL
 * rewritten to flag it as dead (`[Name (deleted)](oldHref)`) — the href is
 * left as-is (it can't resolve to anything current anyway) rather than
 * silently vanishing, so a human reading the reference later still knows
 * *what* used to be there instead of being left with confusing dead text.
 * A directive-attr reference has no separate label to annotate this way —
 * its stale attribute value is left untouched, which is no different from
 * how `project.server.ts` already silently skips any unresolvable
 * `file=`/`folder=` attribute today.
 */
export async function propagateTargetDeletion(
  target: TargetRef,
  deletedName: string,
): Promise<void> {
  const rows = await findReferencingRows(target);
  if (rows.length > 0) {
    const bySource = groupBySource(rows);
    for (const [sourceFileId, refs] of bySource) {
      const source = await getFileRefById(sourceFileId);
      if (!source?.content) continue;
      let content = source.content;

      for (const ref of refs) {
        if (ref.kind !== "mention") continue;
        const hrefMatch = /\]\(([^)]*)\)$/.exec(ref.ref_text);
        const href = hrefMatch?.[1] ?? "";
        const newSnippet = `[${deletedName} (deleted)](${href})`;
        if (content.includes(ref.ref_text)) {
          content = content.split(ref.ref_text).join(newSnippet);
        }
      }

      if (content !== source.content) {
        await updateFileRef(sourceFileId, { content });
      }
    }
  }

  await ensureFileReferencesTable();
  await query(
    `DELETE file_references WHERE target_type = $type AND target_id = $id`,
    { type: target.type, id: target.id },
  );
}
