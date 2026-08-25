import type { LoaderFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById, isFolderUnderSyncs } from "robustness-core/data/vault.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/vault/download/:fileId
 *
 * Returns whatever a client needs to trigger a real "Save As" download —
 * two possible shapes depending on where the file's bytes live:
 *   - S3-backed: `{ url }`, a short-lived presigned S3 URL (embeds
 *     `Content-Disposition: attachment` so the browser saves rather than
 *     opens it inline) — the client just navigates to it.
 *   - Content-only (markdown, a sync-api run's `.csv`/`.md`, `_schema.json`,
 *     ...): `{ content, contentType, filename }` — there's no S3 object to
 *     presign a URL for, so the client Blob-downloads the inline text
 *     itself (see `triggerFileDownload` in `fruits_.vault.tsx`).
 *
 * Only the file owner may download via this endpoint.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (file.human_id !== user._id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sync-scoped tokens may only read files inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(file.folder_id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.s3_key) {
    try {
      const url = await getPresignedDownloadUrl(file.s3_key, file.name);
      return Response.json({ url });
    } catch (err) {
      console.error("Presign download error:", err);
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to generate download URL" },
        { status: 500 },
      );
    }
  }

  if (file.content != null) {
    return Response.json({
      content: file.content,
      contentType: file.content_type,
      filename: file.name,
    });
  }

  return Response.json({ error: "No downloadable content" }, { status: 400 });
}
