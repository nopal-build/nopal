import type { ActionFunctionArgs } from "react-router";
import {
  getFolderById,
  listFolderChildren,
  resolvePublicRootFolder,
} from "robustness-core/data/vault.server";
import {
  computeFolderZipFingerprint,
  ensurePublicZipJob,
} from "robustness-core/data/publicZip.server";

/**
 * POST /api/vault/public-folders/:folderId/zip
 *
 * Enqueues (or reuses — see `publicZip.server.ts`) a background job that
 * zips every direct child file of a published folder. Returns immediately
 * with a job id; the client polls `GET /api/vault/public-zips/:jobId` for
 * progress and the eventual download link — same enqueue-then-poll shape
 * GraphLog's own `api.graphlog.*` routes use.
 *
 * Doing this as a real background job (rather than zipping inline here
 * and streaming the result back) fixes two real problems the inline
 * version had: a big folder of photos could take long enough to make the
 * request feel hung with zero feedback, and there was no way to reuse the
 * same zip across repeat clicks — every "Download all" re-zipped from
 * scratch even when nothing had changed.
 *
 * No auth required, gated purely by the folder being published (or
 * sitting inside a published ancestor) — same 404-not-403 rule
 * `/public/folder/:folderId` itself uses.
 */
export async function action({ params }: ActionFunctionArgs) {
  const { folderId } = params;
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  const folder = await getFolderById(folderId);
  if (!folder) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const publicRoot = await resolvePublicRootFolder(folderId);
  if (!publicRoot) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { files } = await listFolderChildren(folder.human_id, folderId);
  if (!files.length) {
    return Response.json({ error: "This folder has no files to download" }, { status: 400 });
  }

  try {
    const fingerprint = computeFolderZipFingerprint(files);
    const jobId = await ensurePublicZipJob(folderId, fingerprint);
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("Failed to enqueue public zip job:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to start zip" },
      { status: 500 },
    );
  }
}
