import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { letterPageFile } from "robustness-core/data/letters.server";
import { getUser } from "../modules/auth/auth.server";
import { requestHasRenderPass } from "robustness-core/data/letterRenderPass.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";

/**
 * GET /api/letter/:fileId/view/:id
 *
 * A file a letter's page names (`public.letter.$fileId.tsx`): served
 * while the letter's link is on, or to someone on the project once the
 * letter is sent, and only if the sent copy names the id
 * (`letterPageFile`).
 * Same redirect to a short-lived presigned URL as the shared Efforts
 * page's file route. GET only.
 *
 * 404 (not 403) for anything else, so this can't be used to probe which
 * file ids exist.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fileId, id } = params;
  // The page's own doors (`letterPageFile`): the link on, with no
  // session; the worker printing it under a render pass; or a session on
  // the project and the letter sent.
  const viewer = fileId && id ? await getUser(request) : null;
  const rendering = fileId && id ? await requestHasRenderPass(request, fileId) : false;
  const file = fileId && id ? await letterPageFile(fileId, id, viewer?._id ?? null, rendering) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  if (!file.s3_key) return Response.json({ error: "No viewable file attached" }, { status: 400 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
