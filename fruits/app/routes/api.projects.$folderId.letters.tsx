import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { createFileRef, getFileRefsByFolderIds, getFolderById, updateFileRef } from "robustness-core/data/vault.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import { enqueueRenditionsJob } from "robustness-core/data/mediaQueue.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { createMark, markDate } from "robustness-core/data/graphLogMarks.server";
import {
  canManageLetters,
  letterFileName,
  letterPurposeMark,
  ensureLettersFolder,
  newLetterContent,
  rewriteLocalImagePaths,
  splitUploadBundle,
  type UploadedPicture,
} from "robustness-core/data/letters.server";
import type { FileRef } from "robustness-core/data/vault.types";

// Same cap as /api/vault/upload: markdown is stored as the record's own
// content, never as an S3 object (see that route's doc).
const MAX_INLINE_MARKDOWN_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/projects/:folderId/letters
 *
 * Two forms, one folder (`ensureLettersFolder` makes it on first use):
 * - multipart with `file` (repeatable): one markdown file and its
 *   pictures. The pictures are stored first, beside the file; then every
 *   local image path in the markdown that names one of them is pointed at
 *   it (`rewriteLocalImagePaths`), and the ones that matched nothing are
 *   returned as `unmatched` so the tab can name them.
 * - multipart with `name`, `purpose` and `date`, no file: a new, empty
 *   letter with that title (`newLetterContent`), for the Vault's split
 *   editor to open. The purpose line is the guide's one sentence of what
 *   the letter is for (Austin, 2026-10-22: "there's a prompt that asks
 *   what the deliverable is going to be"). It is written on the record
 *   (`FileRef.purpose`) and, as the guide's own words, into the graph as
 *   a mark on the letter (`letterPurposeMark`) dated the writer's day
 *   (`markDate`, the daily log's rule). Refused without one. An upload
 *   may carry `purpose` too; without it the letter has none until the
 *   brief asks.
 * A Guide on the project or staff (`canManageLetters`). Replacing an
 * existing one is `/api/vault/replace/:fileId`, which keeps the id and so
 * the link. Nothing is shared by this route: the link is a separate
 * switch.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const project = params.folderId ? await getFolderById(params.folderId) : null;
  if (!project || !(await isProjectFolder(project))) return Response.json({ error: "Project not found" }, { status: 404 });
  if (!canManageLetters(user, await getProjectRole(project, user._id))) {
    return Response.json({ error: "Only a Guide on this project can add a letter" }, { status: 403 });
  }

  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const name = typeof form.get("name") === "string" ? String(form.get("name")).trim() : "";
  const purpose = typeof form.get("purpose") === "string" ? String(form.get("purpose")).trim() : "";
  const date = markDate(typeof form.get("date") === "string" ? String(form.get("date")) : undefined);

  /** The purpose line, on the record and in the graph as the guide's words. */
  const recordPurpose = async (fileRef: FileRef): Promise<void> => {
    await updateFileRef(fileRef._id, { purpose });
    await createMark({
      projectFolderId: project._id,
      authorHumanId: user._id,
      date,
      text: purpose,
      pageHash: null,
      unit: letterPurposeMark(fileRef),
      suggestion: false,
    });
  };

  if (files.length === 0) {
    if (!name) return Response.json({ error: "No file provided" }, { status: 400 });
    if (!purpose) return Response.json({ error: "Say what this letter is for first." }, { status: 400 });
    const folder = await ensureLettersFolder(project);
    const content = newLetterContent(name);
    const fileRef = await createFileRef({
      human_id: folder.human_id,
      name: letterFileName(name),
      content,
      content_type: "text/markdown",
      content_hash: sha256(content),
      size: Buffer.byteLength(content, "utf8"),
      folder_id: folder._id,
    });
    if (!fileRef) return Response.json({ error: "The letter didn't save. Try again." }, { status: 500 });
    await recordPurpose(fileRef);
    return Response.json({ fileId: fileRef._id, pictures: 0, unmatched: [] }, { status: 201 });
  }

  const split = splitUploadBundle(files);
  if (!split.ok) return Response.json({ error: split.error }, { status: 400 });
  const { markdown, pictures } = split.bundle;
  if (markdown.size > MAX_INLINE_MARKDOWN_BYTES) return Response.json({ error: "That file is too large for a letter (5 MB)" }, { status: 400 });

  const folder = await ensureLettersFolder(project);
  // Filed under the folder's owner, as every upload is, so the folder's
  // own listing finds it (see `api.vault.upload`).
  const ownerHumanId = folder.human_id;

  // Pictures first, beside the file; a name the folder already holds gets
  // " (2)", the way `copyFileIntoFolder` dedupes.
  const taken = new Set((await getFileRefsByFolderIds([folder._id])).map((f) => f.name.toLowerCase()));
  const uploaded: UploadedPicture[] = [];
  for (const picture of pictures) {
    const stored = dedupeName(picture.name, taken);
    taken.add(stored.toLowerCase());
    const safeName = stored.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `vault/${ownerHumanId}/${folder._id}/${Date.now()}-${safeName}`;
    const url = await uploadFileToS3(picture, s3Key);
    const bytes = Buffer.from(await picture.arrayBuffer());
    const ref = await createFileRef({
      human_id: ownerHumanId,
      name: stored,
      s3_url: url,
      s3_key: s3Key,
      content_type: picture.type || "application/octet-stream",
      content_hash: crypto.createHash("sha256").update(bytes).digest("hex"),
      size: picture.size,
      folder_id: folder._id,
    });
    if (!ref) return Response.json({ error: `The picture ${picture.name} didn't save. Try again.` }, { status: 500 });
    await enqueueRenditionsJob(ref._id);
    // Matched by the name the file was uploaded under, which is what the
    // markdown refers to; the stored name may carry " (2)".
    uploaded.push({ name: picture.name, fileId: ref._id });
  }

  const text = await markdown.text();
  const rewritten = rewriteLocalImagePaths(text, uploaded);
  const fileRef = await createFileRef({
    human_id: ownerHumanId,
    name: letterFileName(markdown.name),
    content: rewritten.markdown,
    content_type: "text/markdown",
    content_hash: sha256(rewritten.markdown),
    size: Buffer.byteLength(rewritten.markdown, "utf8"),
    folder_id: folder._id,
  });
  if (!fileRef) return Response.json({ error: "The upload didn't save. Try again." }, { status: 500 });
  if (purpose) await recordPurpose(fileRef);
  return Response.json({ fileId: fileRef._id, pictures: uploaded.length, unmatched: rewritten.unmatched }, { status: 201 });
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
