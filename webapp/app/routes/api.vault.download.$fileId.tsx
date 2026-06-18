import type { LoaderFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFileRefById } from "../data/vault.server";
import { getPresignedDownloadUrl } from "../data/file.server";

/**
 * GET /api/vault/download/:fileId
 *
 * Returns a short-lived presigned S3 download URL for the requested file.
 * The URL embeds `Content-Disposition: attachment` so the browser triggers
 * a save dialog rather than opening the file inline.
 *
 * Only the file owner may download via this endpoint.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

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

  if (!file.s3_key) {
    return Response.json({ error: "No downloadable file attached" }, { status: 400 });
  }

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
