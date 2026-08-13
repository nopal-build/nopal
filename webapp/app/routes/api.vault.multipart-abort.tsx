import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { abortMultipartUpload } from "robustness-core/data/file.server";

/**
 * POST /api/vault/multipart-abort
 * Body (JSON): { uploadId, key }
 *
 * Aborts an in-progress multipart upload to clean up S3 resources.
 * Called automatically on client-side error.
 */
export async function action({ request }: ActionFunctionArgs) {
  // Sync-scope OK: aborting cleans up an upload whose key was issued by
  // multipart-init, which enforces the syncs/ restriction.
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped)
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  const user = scoped.user;

  const body = (await request.json()) as { uploadId?: string; key?: string };
  const { uploadId, key } = body;

  if (!uploadId || !key) {
    return Response.json(
      { error: "uploadId and key are required" },
      { status: 400 },
    );
  }

  if (!key.startsWith(`vault/${user._id}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await abortMultipartUpload(key, uploadId);
    return Response.json({ success: true });
  } catch (err) {
    console.error("Multipart abort error:", err);
    // Don't fail hard on abort — best effort cleanup
    return Response.json({ success: false });
  }
}
