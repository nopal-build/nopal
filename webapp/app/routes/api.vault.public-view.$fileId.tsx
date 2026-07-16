import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getFileRefById, isFileEffectivelyPublic } from "../data/vault.server";
import { getPresignedViewUrl } from "../data/file.server";

/**
 * GET /api/vault/public-view/:fileId
 *
 * Like /api/vault/view/:fileId, but for content reached through a published
 * folder (or an individually published file) — no session or bearer token
 * required. Used as the <img>/<video> src on the /public/* pages.
 *
 * 404 (not 403) whenever the file isn't public, so this can't be used to
 * probe which file ids exist.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file || !(await isFileEffectivelyPublic(file))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!file.s3_key) {
    return Response.json({ error: "No viewable file attached" }, { status: 400 });
  }

  try {
    const url = await getPresignedViewUrl(file.s3_key);
    return redirect(url);
  } catch (err) {
    console.error("Public presign view error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate view URL" },
      { status: 500 },
    );
  }
}
