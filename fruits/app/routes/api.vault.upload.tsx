import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import {
  canWriteToFolderId,
  createFileRef,
  getFolderById,
  isFolderUnderSyncs,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";

// A markdown file (by name or content type -- same check the vault UI's
// own `isMarkdownFile` uses) is stored as a DB-content ref, same as
// README.md/skill files created directly by the app -- NOT as an S3
// blob. Every markdown viewer/editor in the vault (OxRenderer/OxEditor,
// SkillFileEditor) reads `file.content` directly and never falls back to
// S3, so a markdown file uploaded through the OLD s3-only path here
// would always render empty -- confirmed, this was exactly that bug.
// Capped so a mis-named huge binary file doesn't end up as a giant DB
// text field; above this it just falls back to the ordinary S3 path
// (still uploads fine, just won't render inline as editable markdown).
const MAX_INLINE_MARKDOWN_BYTES = 5 * 1024 * 1024;

function isMarkdownUpload(file: File): boolean {
  return file.type === "text/markdown" || file.name.toLowerCase().endsWith(".md");
}

/**
 * POST /api/vault/upload
 *
 * Accepts multipart/form-data:
 *   file     — the File to upload
 *   folderId — (optional) vault folder _id to place the file in
 *
 * Uploads the file to S3 server-side (no browser→S3 CORS required) and
 * creates the corresponding file_ref record -- UNLESS it's a markdown
 * file under `MAX_INLINE_MARKDOWN_BYTES`, in which case its text becomes
 * the file_ref's own `content` (no S3 object at all), matching every
 * other markdown file in the vault (README.md, skill files, Cards).
 */
export async function action({ request }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const folderId = (form.get("folderId") as string | null) || null;

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Sync-scoped tokens may only write inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(folderId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (!(await canWriteToFolderId(folderId, user.role))) {
    return Response.json(
      { error: "You don't have permission to upload files here" },
      { status: 403 },
    );
  }

  // Whose folder is this actually? An owner-tier project Sharing Role
  // (Owner/Crafter) may upload into someone else's shared project exactly
  // like its own owner could — see `canActAsProjectOwner`. This is also
  // the ONLY place that previously checked whether folderId belongs to (or
  // is shared with) the acting human at all; `canWriteToFolderId` above is
  // a root/type-level policy check, not an ownership check.
  const folder = folderId ? await getFolderById(folderId) : null;
  if (folderId && !folder) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  if (folder && !(await canActAsProjectOwner(user._id, folder.human_id, folderId))) {
    return Response.json(
      { error: "You don't have permission to upload files here" },
      { status: 403 },
    );
  }

  // Filed under the FOLDER's own owner -- not necessarily the acting
  // uploader -- since `listFolderChildren` (and everything else that
  // lists a folder's contents) queries by the folder owner's human_id. A
  // file stamped with the acting collaborator's own id instead would
  // silently vanish from the very folder it was just uploaded into.
  const ownerHumanId = folder ? folder.human_id : user._id;

  try {
    if (isMarkdownUpload(file) && file.size <= MAX_INLINE_MARKDOWN_BYTES) {
      const text = await file.text();
      const fileRef = await createFileRef({
        human_id: ownerHumanId,
        name: file.name,
        content: text,
        content_type: "text/markdown",
        content_hash: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
        size: file.size,
        folder_id: folderId,
      });
      return Response.json({ fileRef }, { status: 201 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const folderSegment = folderId ?? "root";
    const s3Key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;
    const url = await uploadFileToS3(file, s3Key);

    // The multipart form is already buffered in memory, so hashing here
    // costs one pass over bytes we already hold. Basis for sync diffing.
    const contentHash = crypto
      .createHash("sha256")
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");

    const fileRef = await createFileRef({
      human_id: ownerHumanId,
      name: file.name,
      s3_url: url,
      s3_key: s3Key,
      content_type: file.type || "application/octet-stream",
      content_hash: contentHash,
      size: file.size,
      folder_id: folderId,
    });

    return Response.json({ url, fileRef }, { status: 201 });
  } catch (err) {
    console.error("Vault upload error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
