import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deliverablePageFile } from "robustness-core/data/deliverables.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";

/**
 * GET /api/deliverable/:fileId/view/:id
 *
 * A file a public deliverable page names (`public.deliverable.$fileId.tsx`),
 * with no session: served only while the deliverable's link is on and
 * only if the deliverable names the id right now (`deliverablePageFile`).
 * Same redirect to a short-lived presigned URL as the shared Efforts
 * page's file route. GET only.
 *
 * 404 (not 403) for anything else, so this can't be used to probe which
 * file ids exist.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId, id } = params;
  const file = fileId && id ? await deliverablePageFile(fileId, id) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  if (!file.s3_key) return Response.json({ error: "No viewable file attached" }, { status: 400 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
