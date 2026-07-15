import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { uploadMultipartPart } from "../data/file.server";

/**
 * POST /api/vault/multipart-part   (multipart/form-data)
 * Fields: uploadId, key, partNumber, chunk (Blob)
 * Returns: { ETag, partNumber }
 *
 * Uploads one chunk to S3 as a multipart part. Chunks are at most 10 MB so
 * this request completes quickly and never hits proxy timeouts.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user)
    return Response.json({ error: "Not authenticated" }, { status: 401 });

  const form = await request.formData();
  const uploadId = form.get("uploadId") as string | null;
  const key = form.get("key") as string | null;
  const partNumberStr = form.get("partNumber") as string | null;
  const chunk = form.get("chunk");

  if (!uploadId || !key || !partNumberStr || !(chunk instanceof Blob)) {
    return Response.json(
      { error: "uploadId, key, partNumber, and chunk are required" },
      { status: 400 },
    );
  }

  // Security: ensure the key belongs to this user
  if (!key.startsWith(`vault/${user._id}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber) || partNumber < 1 || partNumber > 10000) {
    return Response.json({ error: "Invalid partNumber" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await chunk.arrayBuffer());
    const etag = await uploadMultipartPart(key, uploadId, partNumber, buffer);
    return Response.json({ ETag: etag, partNumber });
  } catch (err) {
    console.error("Multipart part error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Part upload failed" },
      { status: 500 },
    );
  }
}
