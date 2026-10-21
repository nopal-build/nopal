/**
 * Deliverables (Austin, 2026-10-06 and 2026-10-21): pages a guide
 * uploads for the client, each one markdown file in the project's
 * `Deliverables` folder, listed on the project's Deliverables tab and
 * shared by its own public link.
 *
 * What is decided here, not in the routes:
 * - The folder is a `deliverables` folder type (`vaultFolderTypes.ts`),
 *   one per project, made by the first upload with a deterministic id so
 *   two uploads can't make two folders (the Skills pattern).
 * - A deliverable is one markdown file. Its pictures are vault files it
 *   names by `/api/vault/view/<id>`; the public page serves exactly
 *   those ids (`publicBody.ts`), and a picture the file doesn't name
 *   draws as nothing. Anything else uploaded into the folder is ignored
 *   by the tab.
 * - The switch is `file_refs.shared_at`, written only by
 *   `setDeliverableShared`. Never `is_public` (that opens the
 *   folder-browsing routes too). The link is the file's own id, so off
 *   then on gives the same URL: the ids are 20 random characters
 *   (`newRecordId`), already unguessable; no token table.
 * - Who switches, uploads and replaces: a Guide on the project, or staff
 *   (`canManageDeliverables`). A Client reads.
 * - The public page is live: every request re-reads the file, so a
 *   replace shows at once under the same link. Off, or a trashed
 *   project, is a 404.
 * - Nothing turns a link on at upload. A person does.
 *
 * The PDF is the public page printed by the worker, keyed by the file's
 * content hash (`deliverablePdf.server.ts`). The share route and the
 * replace route ask for it ahead of the click; this module stays free of
 * the queue so the two don't import each other.
 */

import crypto from "node:crypto";
import { isStaff, type Human } from "./humans.server";
import { findOwningProjectFolder, getProjectRole, type ResolvedProjectRole } from "./projectSharing.server";
import { getProjectStatus } from "./projectStatus.server";
import { splitFrontmatter } from "./project.types";
import { rewriteViewUrls, viewFileIds } from "./publicBody";
import {
  createVaultFolder,
  getFileRefById,
  getFileRefsByFolderIds,
  getFolderById,
  listFolderChildren,
  systemVaultFolderKey,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import type { FileRef } from "./vault.types";
import { parseWebsitePageMeta } from "./website.server";

export const DELIVERABLES_FOLDER_NAME = "Deliverables";

export function isMarkdownFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

export function isDeliverablesFolder(folder: Pick<VaultFolder, "folder_type" | "is_folder_type_root"> | null | undefined): boolean {
  return !!folder && folder.folder_type === "deliverables" && !!folder.is_folder_type_root;
}

/** The project's Deliverables folder, or null before the first upload. */
export async function findDeliverablesFolder(project: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(project.human_id, project._id);
  return folders.filter(isDeliverablesFolder).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

/** The folder, made on first use. Deterministic id, as Skills is made,
 * so a race makes one folder. */
export async function ensureDeliverablesFolder(project: VaultFolder): Promise<VaultFolder> {
  const existing = await findDeliverablesFolder(project);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: project.human_id,
    name: DELIVERABLES_FOLDER_NAME,
    parent_folder_id: project._id,
    folder_type: "deliverables",
    id: systemVaultFolderKey(project.human_id, DELIVERABLES_FOLDER_NAME, project._id),
  });
  if (created) return created;
  const again = await findDeliverablesFolder(project);
  if (!again) throw new Error("Could not create the Deliverables folder");
  return again;
}

/** One row on the tab. `title` is the file's front-matter title, else
 * its name without `.md`. */
export type DeliverableRow = {
  fileId: string;
  name: string;
  title: string;
  updatedAt: string;
  size: number | null;
  sharedAt: string | null;
  /** `contentFingerprint`: what this version's PDF is keyed by. */
  contentHash: string;
};

export function deliverableTitle(file: Pick<FileRef, "name" | "content">): string {
  const meta = parseWebsitePageMeta(file.content ?? "");
  return meta.title ?? file.name.replace(/\.md$/i, "");
}

export function isDeliverableShared(file: Pick<FileRef, "shared_at">): boolean {
  return !!file.shared_at;
}

/** What a version of the file is known by: the stored content hash, else
 * a hash of the content itself (records from before hashing have none).
 * The PDF is keyed by it (`deliverablePdf.server.ts`). */
export function contentFingerprint(file: Pick<FileRef, "content" | "content_hash">): string {
  return file.content_hash ?? crypto.createHash("sha256").update(file.content ?? "", "utf8").digest("hex");
}

/** The markdown files in the folder, newest change first. */
export async function listDeliverables(project: VaultFolder): Promise<DeliverableRow[]> {
  const folder = await findDeliverablesFolder(project);
  if (!folder) return [];
  const files = await getFileRefsByFolderIds([folder._id]);
  return files
    .filter((f) => isMarkdownFileName(f.name) && !f.archived_at)
    .map((f) => ({
      fileId: f._id,
      name: f.name,
      title: deliverableTitle(f),
      updatedAt: f.updated_at,
      size: f.size,
      sharedAt: f.shared_at ?? null,
      contentHash: contentFingerprint(f),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Who uploads, replaces and switches: a Guide on the project, or staff. */
export function canManageDeliverables(
  actor: Pick<Human, "role"> | { role?: string | null } | null | undefined,
  role: Pick<ResolvedProjectRole, "guiding"> | null | undefined,
): boolean {
  return isStaff(actor) || !!role?.guiding;
}

export type DeliverableRefusal = { status: 400 | 403; error: string };

/** The one place the share switch's refusals are decided. Pure, so the
 * test reads every branch without a database. */
export function deliverableShareRefusal(input: { manages: boolean; inDeliverables: boolean; isMarkdown: boolean }): DeliverableRefusal | null {
  if (!input.inDeliverables) return { status: 400, error: "Only a file in the project's Deliverables folder can be shared" };
  if (!input.isMarkdown) return { status: 400, error: "Only a markdown deliverable can be shared" };
  if (!input.manages) return { status: 403, error: "Only a Guide on this project can share a deliverable" };
  return null;
}

/** Where a file lives, when it is a deliverable: its Deliverables folder
 * and the project that folder belongs to. Null for any other file. */
export async function deliverableHome(file: Pick<FileRef, "folder_id">): Promise<{ folder: VaultFolder; project: VaultFolder } | null> {
  if (!file.folder_id) return null;
  const folder = await getFolderById(file.folder_id);
  if (!isDeliverablesFolder(folder)) return null;
  const project = await findOwningProjectFolder(folder!);
  return project ? { folder: folder!, project } : null;
}

export type SetDeliverableSharedResult = { ok: true; sharedAt: string | null } | ({ ok: false } & DeliverableRefusal);

/** Turns a deliverable's link on or off. */
export async function setDeliverableShared(
  actor: Pick<Human, "_id" | "role">,
  file: FileRef,
  on: boolean,
): Promise<SetDeliverableSharedResult> {
  const home = await deliverableHome(file);
  const role = home ? await getProjectRole(home.project, actor._id) : null;
  const refusal = deliverableShareRefusal({
    manages: canManageDeliverables(actor, role),
    inDeliverables: !!home,
    isMarkdown: isMarkdownFileName(file.name),
  });
  if (refusal) return { ok: false, ...refusal };
  const sharedAt = on ? (file.shared_at ?? new Date().toISOString()) : null;
  await updateFileRef(file._id, { shared_at: sharedAt });
  return { ok: true, sharedAt };
}

/** The deliverable behind a public link, with its project, or null: not
 * a deliverable, link off, or project trashed. Checked on every public
 * request, never remembered from a render. */
export async function resolveSharedDeliverable(fileId: string): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const file = await getFileRefById(fileId);
  if (!file || !isDeliverableShared(file) || file.archived_at || !isMarkdownFileName(file.name)) return null;
  const home = await deliverableHome(file);
  if (!home || getProjectStatus(home.project) === "trashed") return null;
  return { file, project: home.project };
}

/** Where the public page loads one of the deliverable's files from. */
export function deliverableViewUrl(fileId: string, id: string): string {
  return `/api/deliverable/${fileId}/view/${id}`;
}

export function deliverablePublicPath(fileId: string): string {
  return `/public/deliverable/${fileId}`;
}

/** The file as the public page shows it: no front matter, every file URL
 * pointing at the deliverable's own route. */
export function publicDeliverableBody(markdown: string, fileId: string): string {
  return rewriteViewUrls(splitFrontmatter(markdown).body, (id) => deliverableViewUrl(fileId, id));
}

/** Whether the page's body opens with its own `# ` heading. The public
 * page then shows no header title of its own, so the title isn't read
 * twice; the author's page is shown as written. */
export function bodyOpensWithTitle(body: string): boolean {
  return /^\s*#\s+\S/.test(body);
}

/** Every file id the deliverable names. Nothing else is served under
 * its link. */
export function deliverableFileIds(markdown: string): Set<string> {
  return viewFileIds(splitFrontmatter(markdown).body);
}

/** The file a public deliverable page may load, or null: the link is on,
 * and the deliverable names the id right now. */
export async function deliverablePageFile(fileId: string, id: string): Promise<FileRef | null> {
  const shared = await resolveSharedDeliverable(fileId);
  if (!shared) return null;
  if (!deliverableFileIds(shared.file.content ?? "").has(id)) return null;
  return (await getFileRefById(id)) ?? null;
}

/** Everything the public page receives, and nothing else. */
export interface DeliverablePage {
  title: string;
  /** The last change, as a date (UTC, so the server and browser agree). */
  updated: string;
  body: string;
  url: string;
  /** The markdown source, the quieter second option. */
  downloadUrl: string;
  /** The page printed (`deliverablePdf.server.ts`). */
  pdfUrl: string;
  fileName: string;
}

export function deliverablePage(file: Pick<FileRef, "_id" | "name" | "content" | "updated_at">, origin: string): DeliverablePage {
  return {
    title: deliverableTitle(file),
    updated: new Date(file.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    body: publicDeliverableBody(file.content ?? "", file._id),
    url: `${origin}${deliverablePublicPath(file._id)}`,
    downloadUrl: `/api/deliverable/${file._id}/download`,
    pdfUrl: `/api/deliverable/${file._id}/pdf`,
    fileName: file.name,
  };
}
