import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getFileRefById, isFileEffectivelyPublic } from "robustness-core/data/vault.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/vault/public-download/:fileId
 *
 * Redirects (302) straight to a presigned, attachment-disposition S3 URL —
 * used as a plain `<a href>` on the /public/* pages (no client JS needed;
 * the S3 response's Content-Disposition triggers the browser's save
 * dialog). No session or bearer token required; gated entirely by the file
 * being effectively public.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file || !(await isFileEffectivelyPublic(file))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!file.s3_key) {
    return Response.json({ error: "No downloadable file attached" }, { status: 400 });
  }

  try {
    const url = await getPresignedDownloadUrl(file.s3_key, file.name);
    return redirect(url);
  } catch (err) {
    console.error("Public presign download error:", err);
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to generate download URL",
      },
      { status: 500 },
    );
  }
}
