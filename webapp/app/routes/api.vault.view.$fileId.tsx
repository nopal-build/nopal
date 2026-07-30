import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById, canViewFileRef } from "../data/vault.server";
import { getPresignedViewUrl } from "../data/file.server";

/**
 * GET /api/vault/view/:fileId
 *
 * Redirects (302) to a short-lived presigned S3 URL for inline viewing —
 * i.e. no `Content-Disposition: attachment`, so it's safe to use directly
 * as `<img src>` or an "open in a new tab" link.
 *
 * This is the *only* supported way to reach a vault file's bytes from the
 * browser now that uploads are stored with a private ACL (see
 * `uploadFileToS3` in file.server.ts) — every vault/daily-log file, however
 * it's referenced (file browser thumbnail, a link inserted via `[[`, or an
 * image embedded via `![[`), should point here by `_id` rather than at a
 * raw S3 URL, so the redirect target is always freshly signed and ownership
 * is re-checked on every request instead of being baked into a permanent,
 * unauthenticated link.
 *
 * Because this redirects rather than returning JSON, it works as a plain
 * same-origin URL anywhere the browser can follow a redirect (img/a/etc) —
 * no client-side fetch dance required. Auth flows via the normal session
 * cookie OR a bearer token (`getUserFromRequest` — a strict superset of
 * session-only `getUser`, checked first here so the CLI/scripts can reach
 * this too, same as `/api/vault/download/:fileId` already could; this used
 * to be session-only, a real inconsistency found while pulling production
 * files down for local dev). Owners and anyone with view access via a
 * shared folder may use this; see `canViewFileRef`.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
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

  if (!(await canViewFileRef(user._id, file))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!file.s3_key) {
    return Response.json({ error: "No viewable file attached" }, { status: 400 });
  }

  try {
    const url = await getPresignedViewUrl(file.s3_key);
    return redirect(url);
  } catch (err) {
    console.error("Presign view error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate view URL" },
      { status: 500 },
    );
  }
}
