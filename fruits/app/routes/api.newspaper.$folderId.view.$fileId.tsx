import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { sharedPageFile } from "robustness-core/data/newspaperShare.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";

/**
 * GET /api/newspaper/:folderId/view/:fileId
 *
 * A file on a shared Efforts page (`public.newspaper.$folderId.tsx`), with
 * no session: served only while the project is shared and only if the
 * page names the file right now (`sharedPageFile`). Same redirect to a
 * short-lived presigned URL as `/api/vault/public-view/:fileId`. GET only.
 *
 * 404 (not 403) for anything else, so this can't be used to probe which
 * file ids exist.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { folderId, fileId } = params;
  const file = folderId && fileId ? await sharedPageFile(folderId, fileId) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  if (!file.s3_key) return Response.json({ error: "No viewable file attached" }, { status: 400 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
