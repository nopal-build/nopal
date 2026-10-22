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
 * content hash (`deliverablePdf.server.ts`). The share route, the replace
 * route and a content save ask for it ahead of the click; this module
 * stays free of the queue so the two don't import each other.
 *
 * Two doors in, one file (Austin, 2026-10-21: a deliverable is a website
 * page that lives in a project). Written here: the Vault's split editor
 * (`vault.tsx`, `DeliverableSplitEditor`), where a dropped or pasted
 * picture uploads beside the file and lands in the text as a standard
 * markdown image. Brought from outside: the markdown and its pictures in
 * one upload; `rewriteLocalImagePaths` points every local image path at
 * the uploaded picture with that name and names the ones it couldn't,
 * so nobody has to find a file id by hand.
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

/** What the banner's Deliverables tile lists: the shared ones only, by
 * title, each to its public page. Everyone on the project sees the same
 * tile, so a Guide sees what the client sees. Pure. */
export function sharedDeliverableLinks(rows: Pick<DeliverableRow, "fileId" | "title" | "sharedAt">[]): { fileId: string; title: string; path: string }[] {
  return rows.filter((r) => !!r.sharedAt).map((r) => ({ fileId: r.fileId, title: r.title, path: deliverablePublicPath(r.fileId) }));
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
  /** False when the body opens with its own `# ` heading
   * (`bodyOpensWithTitle`), so the header doesn't repeat it. Decided here
   * because the page component can't import this server module. */
  showTitle: boolean;
  /** True when a Guide is looking at a deliverable whose link is off:
   * the page as the client would see it, with the session serving the
   * pictures and no downloads (there is no PDF until the link is on). */
  preview: boolean;
}

export function deliverablePage(file: Pick<FileRef, "_id" | "name" | "content" | "updated_at">, origin: string, preview = false): DeliverablePage {
  // A preview keeps the session view URLs: the Guide has a session, and
  // the public file routes refuse an unshared deliverable.
  const body = preview ? splitFrontmatter(file.content ?? "").body : publicDeliverableBody(file.content ?? "", file._id);
  return {
    title: deliverableTitle(file),
    updated: new Date(file.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    body,
    showTitle: !bodyOpensWithTitle(body),
    url: `${origin}${deliverablePublicPath(file._id)}`,
    downloadUrl: `/api/deliverable/${file._id}/download`,
    pdfUrl: `/api/deliverable/${file._id}/pdf`,
    fileName: file.name,
    preview,
  };
}

/** A deliverable a Guide may preview before its link is on (Austin,
 * 2026-10-21: the title on the tab always opens what the client would
 * see). Null for anyone who doesn't manage the project's deliverables,
 * for a non-deliverable, or for a trashed project. */
export async function resolveDeliverableForManager(
  fileId: string,
  actor: Pick<Human, "_id" | "role">,
): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const file = await getFileRefById(fileId);
  if (!file || file.archived_at || !isMarkdownFileName(file.name)) return null;
  const home = await deliverableHome(file);
  if (!home || getProjectStatus(home.project) === "trashed") return null;
  if (!canManageDeliverables(actor, await getProjectRole(home.project, actor._id))) return null;
  return { file, project: home.project };
}

/** The text a new deliverable starts with: a title in front matter (the
 * tab and the public page read it) and the heading the page opens on. */
export function newDeliverableContent(name: string): string {
  const title = name.trim();
  return `---\ntitle: ${title.replace(/"/g, "'")}\n---\n\n# ${title}\n\n`;
}

export function deliverableFileName(name: string): string {
  const base = name.trim().replace(/\.md$/i, "").replace(/[\\/]/g, "-");
  return `${base || "Untitled"}.md`;
}

export function isImageUpload(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|avif|svg)$/i.test(file.name);
}

export function isMarkdownUpload(file: { name: string; type: string }): boolean {
  return file.type === "text/markdown" || isMarkdownFileName(file.name);
}

export type UploadBundle = { markdown: File; pictures: File[] };

/** One markdown file and its pictures, or the one-line reason the
 * upload is refused. The order files arrive in doesn't matter. */
export function splitUploadBundle(files: File[]): { ok: true; bundle: UploadBundle } | { ok: false; error: string } {
  const markdowns = files.filter(isMarkdownUpload);
  const pictures = files.filter((f) => !isMarkdownUpload(f) && isImageUpload(f));
  const others = files.filter((f) => !isMarkdownUpload(f) && !isImageUpload(f));
  if (markdowns.length === 0) return { ok: false, error: "A deliverable is a markdown file (.md), with its pictures alongside" };
  if (markdowns.length > 1) return { ok: false, error: "One deliverable at a time: upload one markdown file, with its pictures alongside" };
  if (others.length > 0) return { ok: false, error: `Only pictures can come with the markdown; not ${others.map((f) => f.name).join(", ")}` };
  return { ok: true, bundle: { markdown: markdowns[0], pictures } };
}

export type UploadedPicture = { name: string; fileId: string };

/** The name a markdown path refers to: its last segment, URL-decoded,
 * lower-cased, without a query or fragment. */
function pathBasename(path: string): string {
  const clean = path.split(/[?#]/)[0].trim();
  const last = clean.split("/").pop() ?? clean;
  try {
    return decodeURIComponent(last).toLowerCase();
  } catch {
    return last.toLowerCase();
  }
}

/** A path the rewrite leaves alone: already on the web, already the
 * vault's, inline data, or an anchor. */
function isExternalPath(path: string): boolean {
  return /^(https?:)?\/\//i.test(path) || path.startsWith("/") || /^(data|mailto|tel):/i.test(path) || path.startsWith("#");
}

/**
 * Points every local image path in `markdown` at the uploaded picture
 * with that file name, and names the paths it couldn't match. Handles
 * `![alt](path)`, `![alt](<a path with spaces>)`, `![alt](path "title")`
 * and reference definitions `[id]: path`. Matching is by basename,
 * case-insensitive, URL-decoded, so `./images/Kitchen.JPG` finds
 * `kitchen.jpg`. Pure; the route calls it after the pictures are stored.
 */
export function rewriteLocalImagePaths(markdown: string, pictures: UploadedPicture[]): { markdown: string; unmatched: string[] } {
  const byName = new Map<string, string>();
  for (const p of pictures) if (!byName.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p.fileId);
  const unmatched: string[] = [];
  const seenUnmatched = new Set<string>();
  const resolve = (rawPath: string): string | null => {
    const path = rawPath.trim();
    if (!path || isExternalPath(path)) return null;
    const id = byName.get(pathBasename(path));
    if (id) return `/api/vault/view/${id}`;
    if (!seenUnmatched.has(path)) {
      seenUnmatched.add(path);
      unmatched.push(path);
    }
    return null;
  };
  // Inline images: the destination is either <...> or a run with no
  // spaces or closing paren, optionally followed by a quoted title.
  const inline = /!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^\s)]+))(\s+"[^"]*"|\s+'[^']*')?\s*\)/g;
  let out = markdown.replace(inline, (whole, alt: string, angled: string | undefined, bare: string | undefined, title: string | undefined) => {
    const target = resolve(angled ?? bare ?? "");
    return target ? `![${alt}](${target}${title ?? ""})` : whole;
  });
  // Reference definitions at a line start: [id]: path "title"
  const definition = /^(\s{0,3}\[[^\]]+\]:\s*)(?:<([^>]*)>|(\S+))(.*)$/gm;
  out = out.replace(definition, (whole, lead: string, angled: string | undefined, bare: string | undefined, rest: string) => {
    const target = resolve(angled ?? bare ?? "");
    return target ? `${lead}${target}${rest}` : whole;
  });
  return { markdown: out, unmatched };
}
