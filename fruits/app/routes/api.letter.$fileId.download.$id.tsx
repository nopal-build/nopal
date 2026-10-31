import type { LoaderFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { requestHasRenderPass } from "robustness-core/data/letterRenderPass.server";
import { letterAttachmentFile } from "robustness-core/data/letters.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/letter/:fileId/download/:id
 *
 * Downloads a file a resolved directive in the letter references
 * INDIRECTLY (today: a `::LoadCellGraph{fileId="..."}`'s own raw/cleaned
 * CSV) — distinct from the existing `/api/letter/:fileId/download` (which
 * downloads the LETTER's own markdown source) and
 * `/api/letter/:fileId/view/:id` (which only serves S3-backed files named
 * literally in the body, e.g. a picture).
 *
 * Same doors as that view route — the link on, with no session; the
 * worker printing it under a render pass; or someone on the project once
 * sent — but allow-listed against `letterAttachmentFile` instead of
 * `letterPageFile`, and handles BOTH inline-content files (a CSV, same as
 * most sync-api runs) and S3-backed ones (same dual shape
 * `/api/vault/download/:fileId` already uses), since a `::LoadCellGraph`'s
 * CSVs are typically inline-content, not S3.
 *
 * 404 (not 403) for anything else, so this can't be used to probe which
 * file ids exist.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fileId, id } = params;
  if (!fileId || !id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const viewer = await getUser(request);
  const rendering = await requestHasRenderPass(request, fileId);
  const file = await letterAttachmentFile(fileId, id, viewer?._id ?? null, rendering);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
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
