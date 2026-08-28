import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  getPresignedUploadUrl,
  getFileContentType,
} from "robustness-core/data/file.server";

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    filename?: string;
    contentType?: string;
    folderId?: string | null;
  };

  if (!body.filename) {
    return Response.json({ error: "filename is required" }, { status: 400 });
  }

  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folderSegment = body.folderId ?? "root";
  const s3Key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;
  const contentType = body.contentType ?? getFileContentType(safeName);

  try {
    const { presignedUrl, publicUrl } = await getPresignedUploadUrl(
      s3Key,
      contentType
    );
    return Response.json({ presignedUrl, publicUrl, s3Key });
  } catch (err) {
    console.error("Vault presign error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Presign failed" },
      { status: 500 }
    );
  }
}
