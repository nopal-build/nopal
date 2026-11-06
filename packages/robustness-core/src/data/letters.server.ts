/**
 * Letters (Austin, 2026-10-06 and 2026-10-21; the word, 2026-10-27):
 * a letter is a human message from one house to the other, each one
 * markdown file in the project's `Letters` folder, listed on the
 * project's Letters tab and shared by its own public link. Called
 * "deliverables" until 2026-10-27; the rename changed the word in the
 * UI and the code so humans, the model and the code share one mental
 * model, and nothing about who reads what.
 *
 * What is decided here, not in the routes:
 * - The folder is a `letters` folder type (`vaultFolderTypes.ts`),
 *   one per project, made by the first upload with a deterministic id so
 *   two uploads can't make two folders (the Skills pattern). A folder
 *   made before the rename was stored as `deliverables`; production's
 *   one such folder was rewritten on 2026-10-27 and the script removed.
 *   The code still reads the old name as the same folder
 *   (`isLettersFolderType`), so a local or staging database from before
 *   then keeps working.
 * - A letter is one markdown file. Its pictures are vault files it
 *   names by `/api/vault/view/<id>`; the public page serves exactly
 *   those ids (`publicBody.ts`), and a picture the file doesn't name
 *   draws as nothing. Anything else uploaded into the folder is ignored
 *   by the tab.
 * - The switch is `file_refs.shared_at`, written only by
 *   `setLetterShared`. Never `is_public` (that opens the
 *   folder-browsing routes too). The link is the file's own id, so off
 *   then on gives the same URL: the ids are 20 random characters
 *   (`newRecordId`), already unguessable; no token table.
 * - Who switches the link, uploads and replaces: a Guide on the project,
 *   or staff (`canManageLetters`). Who writes, talks, sends and deletes:
 *   `mayWriteLetter` (`letterHouses.ts`), a client for their own letter
 *   included.
 * - The public page is live: every request re-reads the file, so a
 *   replace shows at once under the same link. Off, or a trashed
 *   project, is a 404.
 * - Nothing turns a link on at upload. A person does.
 * - Who is shown a sent letter (Austin, 2026-11-05): it is delivered to
 *   a house, the clients' or the guides', and shown to the house it went
 *   to and the house it came from (`letterHouses.ts`). The mailbox on the
 *   project's page holds what came to the viewer's house
 *   (`mailboxLines`); the member's door refuses a Client a letter the
 *   guides sent the guides (`resolveSentLetterForMember`). A letter sent
 *   before houses has none and shows to everyone, as it did.
 *
 * The PDF is the public page printed by the worker, keyed by the file's
 * content hash (`letterPdf.server.ts`). The share route, the replace
 * route and a content save ask for it ahead of the click; this module
 * stays free of the queue so the two don't import each other.
 *
 * Two doors in, one file (Austin, 2026-10-21: a letter is a website
 * page that lives in a project). Written at the desk in its project
 * (`letterDesk.server.ts`, `LetterWriting`), where a dropped or pasted
 * picture uploads beside the file and lands in the text as a standard
 * markdown image. Brought from outside: the markdown and its pictures in
 * one upload; `rewriteLocalImagePaths` points every local image path at
 * the uploaded picture with that name and names the ones it couldn't,
 * so nobody has to find a file id by hand.
 */

import crypto from "node:crypto";
import { isStaff, type Human } from "./humans.server";
import { addressedTo, houseMayOpen, houseOf, housesInMailbox, housesOf, mayWriteLetter, type House, type LetterHouses, type LetterViewer } from "./letterHouses";
import { houseMembers } from "./letterHouses.server";
import { canReadFile } from "./featureAccess.server";
import { findOwningProjectFolder, getProjectRole, type ResolvedProjectRole } from "./projectSharing.server";
import { getProjectStatus } from "./projectStatus.server";
import { merge } from "./generic.server";
import { splitFrontmatter } from "./project.types";
import { rewriteViewUrls, videoFileIds, viewFileIds } from "./publicBody";
import { resolveLoadCellGraphsInBody } from "./loadCellSensorData.server";
import type { ResolvedLoadCellGraph } from "oxmarkdown-core";
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
import type { MarkUnitSnapshot } from "./graphLogMarks.server";
import { isLettersFolderType } from "./vaultFolderTypes";
import { parseWebsitePageMeta } from "./website.server";

export const LETTERS_FOLDER_NAME = "Letters";

export function isMarkdownFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/** The type's root, under either of its stored names (`isLettersFolderType`). */
export function isLettersFolder(folder: Pick<VaultFolder, "folder_type" | "is_folder_type_root"> | null | undefined): boolean {
  return !!folder && isLettersFolderType(folder.folder_type) && !!folder.is_folder_type_root;
}

/** The project's Letters folder, or null before the first upload. */
export async function findLettersFolder(project: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(project.human_id, project._id);
  return folders.filter(isLettersFolder).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

/** The folder, made on first use. Deterministic id, as Skills is made,
 * so a race makes one folder. */
export async function ensureLettersFolder(project: VaultFolder): Promise<VaultFolder> {
  const existing = await findLettersFolder(project);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: project.human_id,
    name: LETTERS_FOLDER_NAME,
    parent_folder_id: project._id,
    folder_type: "letters",
    id: systemVaultFolderKey(project.human_id, LETTERS_FOLDER_NAME, project._id),
  });
  if (created) return created;
  const again = await findLettersFolder(project);
  if (!again) throw new Error("Could not create the Letters folder");
  return again;
}

/** One row on the tab. `title` is the file's front-matter title, else
 * its name without `.md`. */
export type LetterRow = {
  fileId: string;
  name: string;
  title: string;
  updatedAt: string;
  size: number | null;
  sharedAt: string | null;
  /** `contentFingerprint` of the draft. */
  contentHash: string;
  /** The guide's one sentence of what the letter is for (`FileRef.purpose`);
   * null for a letter brought from outside or started before 2026-10-28. */
  purpose: string | null;
  /** The sender's day of the last send (YYYY-MM-DD, `sentCopyOf`): null
   * for a draft nobody has sent. */
  sentDate: string | null;
  sentCount: number;
  /** The sent copy's hash: what its PDF is keyed by. */
  sentHash: string | null;
  /** The draft differs from what the client has. */
  editedSinceSent: boolean;
  /** Who it is from and its two houses (`letterHouses.ts`); null for a
   * draft and for a letter sent before houses. */
  houses: LetterHouses | null;
  /** Who it is from, on a draft too: a client's draft says so from the
   * start (`mayWriteLetter`); a guide's says nothing until sent. */
  fromHumanId: string | null;
  /** Where it is going: its house once sent, else where its draft was
   * addressed when it was started (`addressedTo`); null when neither. */
  toHouse: House | null;
};

/** The client's copy of a letter: what was sent, when, and how many
 * times. A letter whose public link was turned on before letters had a
 * send moment (2026-10-28) counts as sent with its live content, so
 * nothing in a client's hands went dark; `ensureSentCopy` writes that
 * down the first time such a letter is read. Pure. */
/** `at` is the instant; `date` the sender's day (YYYY-MM-DD). */
export type SentCopy = { content: string; hash: string; at: string; date: string; count: number; byHumanId: string | null };

export type SentFields = Pick<FileRef, "content" | "content_hash" | "shared_at" | "sent_content" | "sent_content_hash" | "sent_at" | "sent_date" | "sent_by_human_id" | "sent_count">;

export function sentCopyOf(file: SentFields): SentCopy | null {
  if (file.sent_at && typeof file.sent_content === "string") {
    return {
      content: file.sent_content,
      hash: file.sent_content_hash ?? crypto.createHash("sha256").update(file.sent_content, "utf8").digest("hex"),
      at: file.sent_at,
      date: file.sent_date ?? file.sent_at.slice(0, 10),
      count: file.sent_count ?? 1,
      byHumanId: file.sent_by_human_id ?? null,
    };
  }
  if (file.shared_at) {
    return { content: file.content ?? "", hash: contentFingerprint(file), at: file.shared_at, date: file.shared_at.slice(0, 10), count: 1, byHumanId: null };
  }
  return null;
}

export function isLetterSent(file: SentFields): boolean {
  return sentCopyOf(file) !== null;
}

/** Whether the guide has changed the draft since the client's copy. */
export function letterEditedSinceSent(file: SentFields): boolean {
  const sent = sentCopyOf(file);
  return !!sent && sent.hash !== contentFingerprint(file);
}

export function letterTitle(file: Pick<FileRef, "name" | "content">): string {
  const meta = parseWebsitePageMeta(file.content ?? "");
  return meta.title ?? file.name.replace(/\.md$/i, "");
}

/**
 * The purpose line as a mark on the letter, so it reaches the graph the
 * way a note on a file does: in `Syncs/Marks/<date>-<humanId>.md` in the
 * guide's name on the day they started the letter, highlighted, and
 * guaranteed a node by `marksNotCaptured` when the model passes it over
 * (`syncGraph.server.ts`). A file unit with no citation: a letter is a
 * Vault file, attached to no entry, so the context line reads
 * `On the file "<title>":` and nothing else. The route calls `createMark`
 * with this; the shape is here so the test reads it without a database.
 */
export function letterPurposeMark(file: Pick<FileRef, "_id" | "name" | "content">): MarkUnitSnapshot {
  return {
    key: `file:${file._id}`,
    kind: "file",
    section: "",
    effort: "",
    text: letterTitle(file),
    refs: [],
    attachmentId: file._id,
  };
}

export function isLetterShared(file: Pick<FileRef, "shared_at">): boolean {
  return !!file.shared_at;
}

/** What a version of the file is known by: the stored content hash, else
 * a hash of the content itself (records from before hashing have none).
 * The PDF is keyed by it (`letterPdf.server.ts`). */
export function contentFingerprint(file: Pick<FileRef, "content" | "content_hash">): string {
  return file.content_hash ?? crypto.createHash("sha256").update(file.content ?? "", "utf8").digest("hex");
}

/** The markdown files in the folder, newest change first. */
export async function listLetters(project: VaultFolder): Promise<LetterRow[]> {
  const folder = await findLettersFolder(project);
  if (!folder) return [];
  const files = await getFileRefsByFolderIds([folder._id]);
  for (const f of files) await ensureSentCopy(f);
  return files
    .filter((f) => isMarkdownFileName(f.name) && !f.archived_at)
    .map((f) => ({
      fileId: f._id,
      name: f.name,
      title: letterTitle(f),
      updatedAt: f.updated_at,
      size: f.size,
      sharedAt: f.shared_at ?? null,
      contentHash: contentFingerprint(f),
      purpose: f.purpose ?? null,
      sentDate: sentCopyOf(f)?.date ?? null,
      sentCount: sentCopyOf(f)?.count ?? 0,
      sentHash: sentCopyOf(f)?.hash ?? null,
      editedSinceSent: letterEditedSinceSent(f),
      houses: housesOf(f),
      fromHumanId: f.from_human_id ?? null,
      toHouse: addressedTo(f),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Who uploads, replaces and switches: a Guide on the project, or staff. */
export function canManageLetters(
  actor: Pick<Human, "role"> | { role?: string | null } | null | undefined,
  role: Pick<ResolvedProjectRole, "guiding"> | null | undefined,
): boolean {
  return isStaff(actor) || !!role?.guiding;
}

export type LetterRefusal = { status: 400 | 403; error: string };

/** The one place the share switch's refusals are decided. Pure, so the
 * test reads every branch without a database. */
export function letterShareRefusal(input: { manages: boolean; inLetters: boolean; isMarkdown: boolean; sent?: boolean; on?: boolean }): LetterRefusal | null {
  if (!input.inLetters) return { status: 400, error: "Only a file in the project's Letters folder can be shared" };
  if (!input.isMarkdown) return { status: 400, error: "Only a markdown letter can be shared" };
  if (!input.manages) return { status: 403, error: "Only a Guide on this project can share a letter" };
  // The link is a second step on a sent letter (Austin, 2026-10-27):
  // turning it on publishes the client's copy, so there has to be one.
  if (input.on && input.sent === false) return { status: 400, error: "Send the letter first. The link is a second step." };
  return null;
}

/** The send's own refusals, pure. `writes` is `mayWriteLetter`: a guide
 * for the guides' letters, a client for their own. */
export function letterSendRefusal(input: { writes: boolean; inLetters: boolean; isMarkdown: boolean }): LetterRefusal | null {
  if (!input.inLetters) return { status: 400, error: "Only a file in the project's Letters folder can be sent" };
  if (!input.isMarkdown) return { status: 400, error: "Only a markdown letter can be sent" };
  if (!input.writes) return { status: 403, error: LETTER_NOT_YOURS_TO_SEND };
  return null;
}

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const LETTER_NOT_YOURS_TO_SEND = "This letter isn't yours to send.";

/** Where a file lives, when it is a letter: its Letters folder
 * and the project that folder belongs to. Null for any other file. */
export async function letterHome(file: Pick<FileRef, "folder_id">): Promise<{ folder: VaultFolder; project: VaultFolder } | null> {
  if (!file.folder_id) return null;
  const folder = await getFolderById(file.folder_id);
  if (!isLettersFolder(folder)) return null;
  const project = await findOwningProjectFolder(folder!);
  return project ? { folder: folder!, project } : null;
}

export type SetLetterSharedResult = { ok: true; sharedAt: string | null } | ({ ok: false } & LetterRefusal);

/** Turns a letter's link on or off. */
export async function setLetterShared(
  actor: Pick<Human, "_id" | "role">,
  file: FileRef,
  on: boolean,
): Promise<SetLetterSharedResult> {
  const home = await letterHome(file);
  const role = home ? await getProjectRole(home.project, actor._id) : null;
  const refusal = letterShareRefusal({
    manages: canManageLetters(actor, role),
    inLetters: !!home,
    isMarkdown: isMarkdownFileName(file.name),
    sent: isLetterSent(file),
    on,
  });
  if (refusal) return { ok: false, ...refusal };
  const sharedAt = on ? (file.shared_at ?? new Date().toISOString()) : null;
  await updateFileRef(file._id, { shared_at: sharedAt });
  return { ok: true, sharedAt };
}

/** The letter behind a public link, with its project, or null: not
 * a letter, link off, or project trashed. Checked on every public
 * request, never remembered from a render. */
export async function resolveSharedLetter(fileId: string): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const file = await getFileRefById(fileId);
  if (!file || !isLetterShared(file) || file.archived_at || !isMarkdownFileName(file.name)) return null;
  const home = await letterHome(file);
  if (!home || getProjectStatus(home.project) === "trashed") return null;
  return { file: await ensureSentCopy(file), project: home.project };
}

/**
 * A letter with a public link from before letters had a send moment
 * reads as sent with its live content (`sentCopyOf`); the first time
 * such a letter is read after 2026-10-28, that copy is written down, so
 * the client keeps what they had while the guide goes on editing. One
 * `merge`, once; nothing for a letter already sent or never shared.
 * A write in a read path, on purpose, in place of a one-time script.
 */
export async function ensureSentCopy(file: FileRef): Promise<FileRef> {
  if (file.sent_at || !file.shared_at) return file;
  const sent: Pick<FileRef, "sent_content" | "sent_content_hash" | "sent_at" | "sent_date" | "sent_by_human_id" | "sent_count"> = {
    sent_content: file.content ?? "",
    sent_content_hash: contentFingerprint(file),
    sent_at: file.shared_at,
    sent_date: file.shared_at.slice(0, 10),
    sent_by_human_id: null,
    sent_count: 1,
  };
  await merge("file_refs", file._id, sent);
  return { ...file, ...sent };
}

/**
 * A sent letter, for someone on the project (any group, a Client
 * included: ADR-023 keeps them out of the cache, so this is their door)
 * when the link is off. Null for a draft, for someone off the project,
 * or for a trashed project.
 *
 * And null for a letter that has a house and neither came from nor went
 * to the viewer's (`houseMayOpen`, Austin 2026-11-05): a Client and a
 * letter the guides sent to the guides. This is a Client's only door to
 * a sent letter's words, its pictures and its PDF (the letter's routes
 * all ask it, through `resolveReadableLetter` or directly), so the
 * refusal is here once. A letter with no house is past the check before
 * anyone's house is looked at, and reads as it always did.
 */
export async function resolveSentLetterForMember(fileId: string, humanId: string): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const sent = await resolveSentLetter(fileId);
  if (!sent) return null;
  const role = await getProjectRole(sent.project, humanId);
  if (!role) return null;
  if (!houseMayOpen(sent.file, houseOf(role.role))) return null;
  return sent;
}

/** A sent letter whatever its link, for whoever the caller has already
 * let in: someone on the project (`resolveSentLetterForMember`), or the
 * worker printing it under a render pass (`letterRenderPass.server.ts`).
 * Null for a draft, a non-letter, or a trashed project. */
export async function resolveSentLetter(fileId: string): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const file = await getFileRefById(fileId);
  if (!file || file.archived_at || !isMarkdownFileName(file.name)) return null;
  const home = await letterHome(file);
  if (!home || getProjectStatus(home.project) === "trashed") return null;
  const withCopy = await ensureSentCopy(file);
  if (!isLetterSent(withCopy)) return null;
  return { file: withCopy, project: home.project };
}

/** Who may read a letter's sent copy, and its files, in one place: the
 * link on, with no session; the worker under a render pass (the route
 * checks the header and says so); or someone on the project once sent.
 * The routes that serve the page, its files and its PDF all ask this. */
export async function resolveReadableLetter(
  fileId: string,
  reader: { viewerHumanId?: string | null; rendering?: boolean },
): Promise<{ file: FileRef; project: VaultFolder } | null> {
  const shared = await resolveSharedLetter(fileId);
  if (shared) return shared;
  if (reader.rendering) return resolveSentLetter(fileId);
  return reader.viewerHumanId ? resolveSentLetterForMember(fileId, reader.viewerHumanId) : null;
}

/** Where the public page loads one of the letter's files from. */
export function letterViewUrl(fileId: string, id: string): string {
  return `/api/letter/${fileId}/view/${id}`;
}

export function letterPublicPath(fileId: string): string {
  return `/public/letter/${fileId}`;
}

/** One line in the mailbox: a sent letter that came to the viewer's
 * house. `unopened` is the viewer's own flag for that letter and nobody
 * else's. */
export type MailLine = { fileId: string; title: string; path: string; sentDate: string; updated: boolean; fromHumanId: string | null; unopened: boolean };

/** What is in someone's mailbox (`housesInMailbox`): the letters sent to their
 * house by someone other than them, kept after they are opened, newest
 * send day first; and every letter sent before houses, which nothing can
 * place and which goes on showing to everyone. `flagged` is the viewer's
 * own flags (`flaggedLetterIds`); a letter with no house never has one.
 * The flag on the project's page is "any line here is unopened", so a row
 * left behind by a letter that is gone raises nothing. Pure. */
export function mailboxLines(
  rows: readonly Pick<LetterRow, "fileId" | "title" | "sentDate" | "sentCount" | "houses">[],
  viewer: { humanId: string; house: House | null },
  flagged: ReadonlySet<string> = new Set(),
): MailLine[] {
  return rows
    .filter((r): r is typeof r & { sentDate: string } => !!r.sentDate)
    .filter((r) => housesInMailbox(r.houses, viewer))
    .map((r) => ({
      fileId: r.fileId,
      title: r.title,
      path: letterPublicPath(r.fileId),
      sentDate: r.sentDate,
      updated: r.sentCount > 1,
      fromHumanId: r.houses?.fromHumanId ?? null,
      unopened: !!r.houses && flagged.has(r.fileId),
    }))
    .sort((a, b) => b.sentDate.localeCompare(a.sentDate));
}

/** The file as the public page shows it: no front matter, every file URL
 * pointing at the letter's own route. */
export function publicLetterBody(markdown: string, fileId: string): string {
  return rewriteViewUrls(splitFrontmatter(markdown).body, (id) => letterViewUrl(fileId, id));
}

/** Whether the page's body opens with its own `# ` heading. The public
 * page then shows no header title of its own, so the title isn't read
 * twice; the author's page is shown as written. A recording on top
 * (a one-video gallery, `record-the-letter`) is looked past: the
 * letter's heading is still its first words. */
export function bodyOpensWithTitle(body: string): boolean {
  const rest = body.replace(/^\s*:::gallery[^\n]*\n\s*\[[^\]\n]*\]\([^)\s]*type=video\)\s*\n:::[ \t]*\n/, "");
  return /^\s*#\s+\S/.test(rest);
}

/** Every file id the letter names — a picture's literal view URL and a
 * `::video{fileId="..."}` directive's own attribute (`videoFileIds`, see
 * `publicBody.ts`'s header for why that needs its own pass). Nothing else
 * is served under its link. */
export function letterFileIds(markdown: string): Set<string> {
  const body = splitFrontmatter(markdown).body;
  return new Set([...viewFileIds(body), ...videoFileIds(body)]);
}

/** The file a letter's page may load, or null: the letter is readable
 * (`resolveReadableLetter`: the link on, a render pass, or the viewer on
 * the project and the letter sent); and the sent copy names the id. The
 * draft's pictures are never served this way. */
export async function letterPageFile(fileId: string, id: string, viewerHumanId?: string | null, rendering = false): Promise<FileRef | null> {
  const found = await resolveReadableLetter(fileId, { viewerHumanId, rendering });
  if (!found) return null;
  const sent = sentCopyOf(found.file);
  if (!sent || !letterFileIds(sent.content).has(id)) return null;
  return (await getFileRefById(id)) ?? null;
}

/** The file a letter's writer may load while drafting, or null: the
 * letter's own page and the editor's preview draw the draft through the
 * letter's routes, since the Vault's file routes refuse a client
 * (ADR-023). The person may write the letter (`resolveLetterForWriter`),
 * and the file is one they put beside it themselves (in the letter's
 * folder, stored under their own key: every upload's key starts with
 * the uploader's id, and the worker's transcode keeps it), or one they
 * may read anyway (`canReadFile`: a project photo through the Photos
 * rows, their own day's original). Served whether or not the draft
 * names it yet, since a dropped picture is drawn before the autosave
 * lands. Not the folder's other files: a picture beside a letter the
 * guides sent the guides is not this writer's to see. Asked after
 * `letterPageFile` says no. */
export async function letterDraftFile(fileId: string, id: string, actor: Pick<Human, "_id" | "role">): Promise<FileRef | null> {
  const mine = await resolveLetterForWriter(fileId, actor);
  if (!mine) return null;
  const ref = await getFileRefById(id);
  if (!ref || ref.archived_at) return null;
  if (ref.folder_id === mine.file.folder_id && ref.s3_key?.startsWith(`vault/${actor._id}/`)) return ref;
  return (await canReadFile(actor._id, ref)) ? ref : null;
}

/** Every file id a resolved `::LoadCellGraph{fileId="..."}` directive
 * references INDIRECTLY (its own raw/cleaned CSV) — ids `letterFileIds`
 * alone wouldn't allow, since they're never literally embedded as
 * `/api/vault/view/<id>` in the body the way a picture is. Mirrors
 * `newspaperShare.server.ts`'s own `sharedFileIds`, which takes
 * `galleryFolders` for the exact same reason. */
function letterAttachmentIds(loadCellGraphs: Record<string, ResolvedLoadCellGraph>): Set<string> {
  const ids = new Set<string>();
  for (const graph of Object.values(loadCellGraphs)) {
    ids.add(graph.rawFileId);
    if (graph.cleanedFileId) ids.add(graph.cleanedFileId);
  }
  return ids;
}

/** The file behind a resolved directive's download button (today: a
 * `::LoadCellGraph{...}`'s raw/cleaned CSV), or null — same doors as
 * `letterPageFile` (the letter must be readable), but allow-listed against
 * `letterAttachmentIds` instead of `letterFileIds`, since these ids are
 * never literally written in the body. Re-resolves the letter's
 * `loadCellGraphs` itself (self-healing, same convention
 * `resolveLoadCellGraphByFileId` already has, and cheap — a letter's own
 * CSV is at most a few thousand rows) rather than trusting a caller-passed
 * map that could be stale. */
export async function letterAttachmentFile(fileId: string, id: string, viewerHumanId?: string | null, rendering = false): Promise<FileRef | null> {
  const found = await resolveReadableLetter(fileId, { viewerHumanId, rendering });
  if (!found) return null;
  const sent = sentCopyOf(found.file);
  if (!sent) return null;
  const loadCellGraphs = await resolveLoadCellGraphsInBody(splitFrontmatter(sent.content).body);
  if (!letterAttachmentIds(loadCellGraphs).has(id)) return null;
  return (await getFileRefById(id)) ?? null;
}

/** Everything the public page receives, and nothing else. */
export interface LetterPage {
  title: string;
  /** The sender's day of the send, as "Oct 28, 2026"; for a preview,
   * the draft's last change (UTC, so the server and browser agree). */
  updated: string;
  /** The client is reading an update: sent more than once. */
  resent: boolean;
  body: string;
  url: string;
  /** The markdown source, the quieter second option. */
  downloadUrl: string;
  /** The page printed (`letterPdf.server.ts`). */
  pdfUrl: string;
  fileName: string;
  /** False when the body opens with its own `# ` heading
   * (`bodyOpensWithTitle`), so the header doesn't repeat it. Decided here
   * because the page component can't import this server module. */
  showTitle: boolean;
  /** True when a Guide is looking at a letter not yet sent: the draft
   * as the client will see it, with the session serving the pictures
   * and no downloads. */
  preview: boolean;
  /** The public link is on. The PDF and the source are offered on any
   * sent copy, link on or off (the worker prints a link-off letter under
   * a render pass, and both routes admit someone on the project). */
  linkOn: boolean;
  /** Keyed by a `::LoadCellGraph{fileId="..."}` directive's `fileId`
   * attribute value — resolved by the caller (`resolveLetterPage`, which
   * needs real vault/DB access `letterPage` itself deliberately doesn't
   * touch, so it stays a pure, synchronous "shape the fields" function —
   * see its own tests) and handed in here, same "resolved externally,
   * passed down as a plain prop" shape `ProjectView`'s `loadCellGraphs`
   * already uses. Empty when the body references none. */
  loadCellGraphs: Record<string, ResolvedLoadCellGraph>;
  /** Where a `::video{fileId="..."}` directive's own file loads from,
   * minus the final `/<id>` (the route builds `${videoViewUrlBase}/${id}`
   * — loader data can't carry a function across the wire, the same reason
   * `downloadUrl`/`pdfUrl` are plain strings a `::LoadCellGraph{...}`'s own
   * download buttons build on). Set for a preview too: the letter's routes
   * serve a draft's files to its writer (`letterDraftFile`), which is how
   * a client sees their own pictures (the Vault's routes refuse them). */
  videoViewUrlBase: string | null;
}

export function letterPage(
  file: Pick<FileRef, "_id" | "name" | "updated_at"> & SentFields,
  origin: string,
  preview = false,
  loadCellGraphs: Record<string, ResolvedLoadCellGraph> = {},
): LetterPage {
  // A preview is the draft; the page itself is the sent copy. Both are
  // rewritten to the letter's own routes, which serve the sent copy's
  // files to its readers and a draft's to its writer (`letterDraftFile`),
  // so the preview is what the page will be, for a client too.
  const sent = preview ? null : sentCopyOf(file);
  const source = sent ? sent.content : (file.content ?? "");
  const body = publicLetterBody(source, file._id);
  const dated = sent ? `${sent.date}T00:00:00Z` : file.updated_at;
  return {
    title: letterTitle({ name: file.name, content: source }),
    updated: new Date(dated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    resent: !!sent && sent.count > 1,
    body,
    showTitle: !bodyOpensWithTitle(body),
    url: `${origin}${letterPublicPath(file._id)}`,
    downloadUrl: `/api/letter/${file._id}/download`,
    pdfUrl: `/api/letter/${file._id}/pdf`,
    fileName: file.name,
    preview,
    linkOn: !preview && !!file.shared_at,
    loadCellGraphs,
    videoViewUrlBase: `/api/letter/${file._id}/view`,
  };
}

/** `letterPage`, plus resolving any `::LoadCellGraph{fileId="..."}`
 * directives the body references — needs real vault/DB access
 * (`resolveLoadCellGraphsInBody`), so can't live inside `letterPage` itself
 * (which stays a pure, synchronous "shape the fields" function — see its
 * own tests). The one function the real route
 * (`public.letter.$fileId.tsx`) actually calls; `letterPage` alone is for
 * tests and anything that already has a resolved `loadCellGraphs` map in
 * hand. */
export async function resolveLetterPage(
  file: Pick<FileRef, "_id" | "name" | "updated_at"> & SentFields,
  origin: string,
  preview = false,
): Promise<LetterPage> {
  const sent = preview ? null : sentCopyOf(file);
  const source = sent ? sent.content : (file.content ?? "");
  const loadCellGraphs = await resolveLoadCellGraphsInBody(splitFrontmatter(source).body);
  return letterPage(file, origin, preview, loadCellGraphs);
}

/** Who is writing, as the write rule sees them (`mayWriteLetter`): a
 * client's letter is a client's, anyone else's a guide's. */
export type LetterWriterKind = "guide" | "client";

/** The viewer `mayWriteLetter` reads, from a role already resolved. */
export function letterViewerOf(humanId: string, role: Pick<ResolvedProjectRole, "role" | "guiding"> | null | undefined): LetterViewer {
  return { humanId, house: houseOf(role?.role), guiding: !!role?.guiding };
}

/** A letter this person may write (`mayWriteLetter`, `letterHouses.ts`):
 * a Guide on the project for any letter but a client's, a client for a
 * letter from them. Null for anyone else, for a non-letter, an archived
 * one, or a trashed project. Every write route and the writing page ask
 * this; the brief alone stays the manager's (`letterForManager`, in the
 * app). Before the send the title on the tab opens the writer's preview
 * (Austin, 2026-10-21: it always opens what the reader would see). */
export async function resolveLetterForWriter(
  fileId: string,
  actor: Pick<Human, "_id" | "role">,
): Promise<{ file: FileRef; project: VaultFolder; writer: LetterWriterKind } | null> {
  const file = await getFileRefById(fileId);
  if (!file || file.archived_at || !isMarkdownFileName(file.name)) return null;
  const home = await letterHome(file);
  if (!home || getProjectStatus(home.project) === "trashed") return null;
  const viewer = letterViewerOf(actor._id, await getProjectRole(home.project, actor._id));
  if (!mayWriteLetter(viewer, file, await houseMembers(home.project))) return null;
  return { file, project: home.project, writer: viewer.house === "clients" ? "client" : "guide" };
}

/** The text a new letter starts with: a title in front matter (the
 * tab and the public page read it) and the heading the page opens on. */
export function newLetterContent(name: string): string {
  const title = name.trim();
  return `---\ntitle: ${title.replace(/"/g, "'")}\n---\n\n# ${title}\n\n`;
}

export function letterFileName(name: string): string {
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
  if (markdowns.length === 0) return { ok: false, error: "A letter is a markdown file (.md), with its pictures alongside" };
  if (markdowns.length > 1) return { ok: false, error: "One letter at a time: upload one markdown file, with its pictures alongside" };
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
