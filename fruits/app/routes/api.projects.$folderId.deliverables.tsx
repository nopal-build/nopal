import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { createFileRef, getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { canManageDeliverables, ensureDeliverablesFolder, isMarkdownFileName } from "robustness-core/data/deliverables.server";

// Same cap as /api/vault/upload: markdown is stored as the record's own
// content, never as an S3 object (see that route's doc).
const MAX_INLINE_MARKDOWN_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/projects/:folderId/deliverables
 *
 * Uploads one markdown deliverable into the project's Deliverables
 * folder, making the folder on first use (`ensureDeliverablesFolder`).
 * multipart/form-data with `file`. A Guide on the project or staff
 * (`canManageDeliverables`); markdown only; replacing an existing one
 * is `/api/vault/replace/:fileId`, which keeps the id and so the link.
 * Nothing is shared by this route: the link is a separate switch.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const project = params.folderId ? await getFolderById(params.folderId) : null;
  if (!project || !(await isProjectFolder(project))) return Response.json({ error: "Project not found" }, { status: 404 });
  if (!canManageDeliverables(user, await getProjectRole(project, user._id))) {
    return Response.json({ error: "Only a Guide on this project can upload a deliverable" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 });
  if (!isMarkdownFileName(file.name) && file.type !== "text/markdown") {
    return Response.json({ error: "A deliverable is a markdown file (.md)" }, { status: 400 });
  }
  if (file.size > MAX_INLINE_MARKDOWN_BYTES) return Response.json({ error: "That file is too large for a deliverable (5 MB)" }, { status: 400 });

  const folder = await ensureDeliverablesFolder(project);
  const text = await file.text();
  const name = isMarkdownFileName(file.name) ? file.name : `${file.name}.md`;
  // Filed under the folder's owner, as every upload is, so the folder's
  // own listing finds it (see `api.vault.upload`).
  const fileRef = await createFileRef({
    human_id: folder.human_id,
    name,
    content: text,
    content_type: "text/markdown",
    content_hash: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    size: file.size,
    folder_id: folder._id,
  });
  if (!fileRef) return Response.json({ error: "The upload didn't save. Try again." }, { status: 500 });
  return Response.json({ fileId: fileRef._id }, { status: 201 });
}
