import type { LoaderFunctionArgs } from "react-router";
import { getPublicZipJobStatus } from "robustness-core/data/publicZip.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/vault/public-zips/:jobId
 *
 * Polled by `/public/folder/:folderId` after enqueuing a zip via
 * `POST /api/vault/public-folders/:folderId/zip` — mirrors GraphLog's own
 * `api.graphlog.jobs.$jobId.tsx` enqueue-then-poll shape, on the zip
 * queue instead (see `publicZip.server.ts`).
 *
 * `waiting`/`active`/`delayed` responses include `progress` (files zipped
 * so far / total) straight off the BullMQ job, updated live by the worker
 * — real feedback while it runs, not just a spinner. A `completed`
 * response additionally resolves a fresh, short-lived presigned S3
 * `downloadUrl` for the already-built zip (never a bare S3 key — the
 * bucket is private) with `Content-Disposition: attachment` baked in via
 * `getPresignedDownloadUrl`, so the client's own <a href> just works.
 *
 * No ownership check beyond the job existing — same public-by-design
 * posture as everything else under `/public/*`; a job id is an opaque,
 * unguessable BullMQ id, not a sequential one.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params;
  if (!jobId) {
    return Response.json({ error: "jobId required" }, { status: 400 });
  }

  const status = await getPublicZipJobStatus(jobId);
  if (!status.ok) {
    return Response.json({ error: status.error }, { status: 404 });
  }

  if (status.state === "completed" && status.result) {
    const folder = await getFolderById(status.folderId);
    const safeName = (folder?.name || "download").replace(/[^a-zA-Z0-9._-]/g, "_");
    try {
      const downloadUrl = await getPresignedDownloadUrl(status.result.s3Key, `${safeName}.zip`);
      return Response.json({
        state: status.state,
        downloadUrl,
        size: status.result.size,
        fileCount: status.result.fileCount,
      });
    } catch (err) {
      console.error("Failed to presign public zip download:", err);
      return Response.json({ error: "Failed to generate download link" }, { status: 500 });
    }
  }

  return Response.json({
    state: status.state,
    progress: status.state === "waiting" || status.state === "active" ? (status.progress ?? null) : null,
    error: status.state === "failed" ? status.error : undefined,
  });
}
