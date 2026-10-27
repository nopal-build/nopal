import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { letterPageFile } from "robustness-core/data/letters.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";

/**
 * GET /api/letter/:fileId/view/:id
 *
 * A file a public letter page names (`public.letter.$fileId.tsx`),
 * with no session: served only while the letter's link is on and
 * only if the letter names the id right now (`letterPageFile`).
 * Same redirect to a short-lived presigned URL as the shared Efforts
 * page's file route. GET only.
 *
 * 404 (not 403) for anything else, so this can't be used to probe which
 * file ids exist.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId, id } = params;
  const file = fileId && id ? await letterPageFile(fileId, id) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  if (!file.s3_key) return Response.json({ error: "No viewable file attached" }, { status: 400 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
