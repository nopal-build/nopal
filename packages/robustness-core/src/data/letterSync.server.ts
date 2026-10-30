/**
 * The graph's copy of a sent letter (Austin, 2026-10-27: "the letter is
 * our most distilled thoughts on this thing, so those should go back in
 * the graph ... sending it is when it writes"). Written into
 * `Syncs/Letters/<date>-<humanId>.md`, one file per guide per send day
 * holding every letter they sent that day, the way `Syncs/Marks/` holds
 * a person's marks: sync-graph names a source's author from exactly that
 * file name and reads the whole file as the guide's own words, extracted
 * into points on that day. A resend rewrites the file (a new hash, the
 * day re-extracts); a letter that moves to another day leaves its old
 * file emptied with its date kept, so the old day is still visited and
 * re-extracted without it (a deleted file would leave the old nodes in
 * the graph for good). The brief, the talk-through's outline and the
 * draft never come here. Pure where it can be (`lettersProjectionFiles`).
 */

import { createHash } from "node:crypto";
import { findLettersFolder, isMarkdownFileName, letterTitle, sentCopyOf, type SentCopy } from "./letters.server";
import { splitFrontmatter } from "./project.types";
import { createFileRef, createVaultFolder, getFileRefsByFolderIds, listFolderChildren, systemVaultFolderKey, updateFileRef } from "./vault.server";
import { ensureSyncsFolder } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";
import { isWebsiteFolder } from "./vaultFolderTypes";

/** Under the project's Syncs folder; not the project's own Letters
 * folder, where the drafts live. */
export const LETTERS_SYNC_FOLDER_NAME = "Letters";

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type SentLetterForSync = { fileId: string; name: string; sent: SentCopy; senderHumanId: string };

/** The files the projection holds: name, date and content, from the
 * sent letters. One file per (send day, sender); letters in send order;
 * each as `## <title>` then its sent body without front matter, letters
 * separated by `---`. Pure. */
export function lettersProjectionFiles(letters: readonly SentLetterForSync[]): { name: string; date: string; content: string }[] {
  const byDay = new Map<string, SentLetterForSync[]>();
  for (const letter of letters) {
    const name = `${letter.sent.date}-${letter.senderHumanId}.md`;
    byDay.set(name, [...(byDay.get(name) ?? []), letter]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dayLetters]) => {
      const sorted = [...dayLetters].sort((a, b) => a.sent.at.localeCompare(b.sent.at));
      const content = sorted
        .map((l) => `## ${letterTitle({ name: l.name, content: l.sent.content })}\n\n${splitFrontmatter(l.sent.content).body.trim()}`)
        .join("\n\n---\n\n");
      return { name, date: sorted[0].sent.date, content: `${content}\n` };
    });
}

async function findLettersSyncFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return null;
  const { folders: syncFolders } = await listFolderChildren(projectFolder.human_id, syncs._id);
  return syncFolders.find((f) => f.name === LETTERS_SYNC_FOLDER_NAME) ?? null;
}

/** `Syncs/Letters/`, created the first time a project has a sent letter. */
async function ensureLettersSyncFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const syncsFolder = await ensureSyncsFolder(projectFolder);
  const { folders } = await listFolderChildren(projectFolder.human_id, syncsFolder._id);
  const existing = folders.filter((f) => f.name === LETTERS_SYNC_FOLDER_NAME).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: LETTERS_SYNC_FOLDER_NAME,
    parent_folder_id: syncsFolder._id,
    id: systemVaultFolderKey(projectFolder.human_id, LETTERS_SYNC_FOLDER_NAME, syncsFolder._id),
  });
  if (!created) throw new Error("Failed to create the project's syncs/Letters folder");
  return created;
}

/** The project's sent letters, as the projection reads them. A sender
 * is the guide who sent it; a letter sent before letters had a send
 * moment names nobody and goes under the project's creator. */
export async function sentLettersForSync(projectFolder: VaultFolder): Promise<SentLetterForSync[]> {
  const folder = await findLettersFolder(projectFolder);
  if (!folder) return [];
  const files: FileRef[] = await getFileRefsByFolderIds([folder._id]);
  const out: SentLetterForSync[] = [];
  for (const f of files) {
    if (!isMarkdownFileName(f.name) || f.archived_at) continue;
    const sent = sentCopyOf(f);
    if (!sent) continue;
    out.push({ fileId: f._id, name: f.name, sent, senderHumanId: sent.byHumanId ?? projectFolder.human_id });
  }
  return out;
}

/**
 * Writes the project's sent letters into `Syncs/Letters/`, rebuilt from
 * the records every time and written only where the content changed,
 * the content-hash rule the Card copies follow. A project with no sent
 * letter and no folder returns before touching anything.
 */
export async function syncLettersProjection(projectFolder: VaultFolder): Promise<{ written: number }> {
  if (isWebsiteFolder(projectFolder)) return { written: 0 };
  const letters = await sentLettersForSync(projectFolder);
  if (letters.length === 0 && !(await findLettersSyncFolder(projectFolder))) return { written: 0 };

  const wanted = lettersProjectionFiles(letters);
  const wantedByName = new Map(wanted.map((w) => [w.name, w]));
  const lettersFolder = await ensureLettersSyncFolder(projectFolder);
  const { files } = await listFolderChildren(projectFolder.human_id, lettersFolder._id);
  const existingByName = new Map(files.map((f) => [f.name, f]));
  // A day whose letters moved or were taken back is emptied, its date
  // kept, so sync-graph visits it and re-extracts without them.
  const emptyHash = contentHash("");
  for (const [name, file] of existingByName) {
    if (wantedByName.has(name) || file.content_hash === emptyHash) continue;
    await updateFileRef(file._id, { content: "", content_hash: emptyHash });
  }
  let written = 0;
  for (const w of wanted) {
    const hash = contentHash(w.content);
    const existing = existingByName.get(w.name);
    if (existing?.content_hash === hash) continue;
    if (existing) {
      await updateFileRef(existing._id, { content: w.content, content_hash: hash, date: w.date });
    } else {
      await createFileRef({
        human_id: projectFolder.human_id,
        name: w.name,
        content: w.content,
        content_type: "text/markdown",
        content_hash: hash,
        folder_id: lettersFolder._id,
        date: w.date,
      });
    }
    written++;
  }
  return { written };
}
