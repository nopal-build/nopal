import type { ActionFunctionArgs } from "react-router";
import { abortMultipartUpload, listStaleMultipartUploads } from "robustness-core/data/file.server";

/**
 * POST /api/vault/multipart-sweep
 *
 * Aborts multipart uploads that were opened more than a day ago and never
 * finished. Browsers send parts straight to storage (`vaultUpload.ts`), so
 * a tab closed mid-upload leaves parts behind that no file points at and
 * nobody can see, still billed. The browser aborts what it can; this
 * catches the rest. Protected by CRON_SECRET, called daily by server.js.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("multipart-sweep: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const stale = await listStaleMultipartUploads(new Date(Date.now() - STALE_AFTER_MS));
  let aborted = 0;
  for (const { key, uploadId } of stale) {
    try {
      await abortMultipartUpload(key, uploadId);
      aborted++;
    } catch (err) {
      console.error(`multipart-sweep: could not abort ${key}:`, err);
    }
  }
  return Response.json({ found: stale.length, aborted });
}
