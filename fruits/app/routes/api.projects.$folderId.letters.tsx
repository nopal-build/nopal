import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest, isImpersonating } from "../modules/auth/auth.server";
import { createFileRef, getFileRefsByFolderIds, getFolderById, updateFileRef } from "robustness-core/data/vault.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import { enqueueRenditionsJob } from "robustness-core/data/mediaQueue.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { createMark, markDate } from "robustness-core/data/graphLogMarks.server";
import { requestBrief, writeLetterBriefRow } from "robustness-core/data/brief.server";
import { reflectionToStartFrom } from "robustness-core/data/letterReflection.server";
import {
  canManageLetters,
  letterFileName,
  letterViewerOf,
  letterPurposeMark,
  ensureLettersFolder,
  newLetterContent,
  rewriteLocalImagePaths,
  splitUploadBundle,
  type UploadedPicture,
} from "robustness-core/data/letters.server";
import { merge } from "robustness-core/data/generic.server";
import { houseAtStart, mayStartLetter } from "robustness-core/data/letterHouses";
import { houseMembers } from "robustness-core/data/letterHouses.server";
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
 *   A new letter also carries `to`, the house it is for ("clients" or
 *   "guides", shown as the team): required on a project with clients,
 *   refused without it (`houseAtStart`). An upload carries none and is
 *   asked at Send.
 *   Starting a letter with "Write the brief first" is also the click that
 *   writes its brief (Austin, 2026-10-28; the form says so): the route
 *   asks the worker for it (`requestBrief`) once the letter and its
 *   purpose exist. `brief=skip` ("Go straight to the letter", Austin
 *   2026-11-03) runs nothing; the letter's page offers the brief later.
 *   The upload path does not; "Write it again" on the letter's page does.
 *
 * A client starts a letter too (Austin, 2026-11-05: both houses write;
 * `mayStartLetter`), never uploads one. Theirs goes to the team whatever
 * the form says, is from them from this moment (`from_human_id` on the
 * draft, which is what makes it theirs: `mayWriteLetter`), takes no
 * purpose line and gets no brief ("A client is not offered the purpose
 * line... and does not get the brief"). A kept talk-through (`from`)
 * starts theirs as it starts a guide's.
 * A Guide on the project or staff (`canManageLetters`). Replacing an
 * existing one is `/api/vault/replace/:fileId`, which keeps the id and so
 * the link. Nothing is shared by this route: the link is a separate
 * switch.
 */
// Words a person reads (Nopal's voice; listed in the round's return leg).
const LETTER_FROM_GONE = "What you said about that letter isn't there to start from.";
const LETTER_START_REFUSED = "You can't start a letter on this project.";

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const project = params.folderId ? await getFolderById(params.folderId) : null;
  if (!project || !(await isProjectFolder(project))) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(project, user._id);
  const viewer = letterViewerOf(user._id, role);
  const manages = canManageLetters(user, role);
  // A client is in the clients' house with no `guiding`; a Guide on the
  // project, or staff, manages. Neither: nothing to start here.
  const asClient = !manages && viewer.house === "clients";
  if (!manages && !mayStartLetter(viewer)) {
    return Response.json({ error: LETTER_START_REFUSED }, { status: 403 });
  }

  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const name = typeof form.get("name") === "string" ? String(form.get("name")).trim() : "";
  // A client's letter has no purpose line, whatever the form carried.
  const purpose = !asClient && typeof form.get("purpose") === "string" ? String(form.get("purpose")).trim() : "";
  // Bringing a letter from outside is a manager's (the file, its pictures).
  if (files.length > 0 && !manages) return Response.json({ error: LETTER_START_REFUSED }, { status: 403 });
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
    if (!purpose && !asClient) return Response.json({ error: "Say what this letter is for first." }, { status: 400 });
    // Who it is for, picked on the same form (Austin, 2026-11-05: "what's
    // the title, why are you writing it, and who are you writing it to"):
    // the clients or the team, no default; nothing to pick on a project
    // with no clients (`houseAtStart`). Kept on the draft, and Send
    // delivers it there. A client's goes to the team, always, and the
    // form has nothing to pick.
    const address = asClient
      ? ({ ok: true, toHouse: "guides" } as const)
      : houseAtStart({ projectHasClients: (await houseMembers(project)).some((m) => m.house === "clients"), asked: form.get("to") });
    if (!address.ok) return Response.json({ error: address.error }, { status: address.status });
    // Started from what this guide said about a letter they read (`from`,
    // that letter's id; Austin, 2026-11-06: "spending the time to sit
    // down and write a letter back, based on those thoughts"). Still a
    // new letter with its own title, purpose and address. Asked again
    // here, whatever the page offered: theirs, kept, a letter they may
    // still open, in this project; and never for an admin looking as
    // them, since it carries their words into a letter.
    const fromLetterId = typeof form.get("from") === "string" ? String(form.get("from")) : "";
    const startFrom = fromLetterId && !(await isImpersonating(request)) ? await reflectionToStartFrom(project, fromLetterId, user._id) : null;
    if (fromLetterId && !startFrom) return Response.json({ error: LETTER_FROM_GONE }, { status: 400 });
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
    // `merge`: the address is not one of the fields a save may set. A
    // client's draft also says who it is from, which is what makes it
    // theirs and nobody else's (`mayWriteLetter`); a guide's says so at
    // its first send (`sendLetter`).
    await merge("file_refs", fileRef._id, { to_house: address.toHouse, ...(asClient ? { from_human_id: user._id } : {}) });
    if (purpose) await recordPurpose(fileRef);
    if (startFrom) {
      // Their reflection is this letter's talk-through, and it is already
      // on the record (its Card and day come with it, so Send lands
      // nothing twice). Which letter was read is kept on the letter's
      // workings, for the outline; the letter's own record names no other
      // letter. No brief: the letter they read stands where it would.
      await writeLetterBriefRow(fileRef._id, {
        letter_file_id: fileRef._id,
        project_folder_id: project._id,
        talk_through: startFrom.row.text,
        talk_through_at: startFrom.row.kept_at ?? new Date().toISOString(),
        talk_through_by_human_id: user._id,
        talk_through_date: startFrom.row.kept_date ?? null,
        talk_through_card_file_id: startFrom.row.card_file_id ?? null,
        reflects_on_letter_file_id: fromLetterId,
      });
      return Response.json({ fileId: fileRef._id, pictures: 0, unmatched: [], briefJobId: null }, { status: 201 });
    }
    // The brief starts as the letter opens. A queue that refuses leaves a
    // letter with no brief and the page's own button; never a lost letter.
    let briefJobId: string | null = null;
    if (!asClient && String(form.get("brief") ?? "") !== "skip") {
      try {
        const asked = await requestBrief(project, { ...fileRef, purpose }, user._id);
        if (asked.ok) briefJobId = asked.jobId;
      } catch (err) {
        console.error("Brief enqueue error:", err);
      }
    }
    return Response.json({ fileId: fileRef._id, pictures: 0, unmatched: [], briefJobId }, { status: 201 });
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
