import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { createMultipartUpload } from "../data/file.server";

/**
 * POST /api/vault/multipart-init
 * Body (JSON): { filename, contentType, folderId?, originalName, size }
 * Returns: { uploadId, key }
 *
 * Creates an S3 multipart upload session. The key is returned so the client
 * can reference it in subsequent part and complete requests.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user)
    return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as {
    filename?: string;
    contentType?: string;
    folderId?: string | null;
    originalName?: string;
  };

  const { filename, contentType, folderId } = body;
  if (!filename || !contentType) {
    return Response.json(
      { error: "filename and contentType are required" },
      { status: 400 },
    );
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folderSegment = folderId ?? "root";
  const key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;

  try {
    const uploadId = await createMultipartUpload(key, contentType);
    return Response.json({ uploadId, key });
  } catch (err) {
    console.error("Multipart init error:", err);
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to initiate upload",
      },
      { status: 500 },
    );
  }
}
