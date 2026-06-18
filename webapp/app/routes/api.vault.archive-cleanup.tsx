import type { ActionFunctionArgs } from "react-router";
import { getArchivedFilesForCleanup, deleteFileRef } from "../data/vault.server";

/**
 * POST /api/vault/archive-cleanup
 *
 * Permanently deletes all vault files that were archived more than 30 days ago.
 * Protected by the CRON_SECRET environment variable.
 *
 * Usage (e.g. from a Fly.io scheduled machine or external cron service):
 *
 *   curl -X POST https://<your-app>.fly.dev/api/vault/archive-cleanup \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * To set up a daily scheduled machine on Fly.io:
 *   fly machine run --app <app-name> \
 *     --schedule daily \
 *     --env CRON_SECRET=<your-secret> \
 *     --entrypoint 'sh -c "curl -fsS -X POST http://localhost:3000/api/vault/archive-cleanup -H \"Authorization: Bearer $CRON_SECRET\""'
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("archive-cleanup: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const files = await getArchivedFilesForCleanup(30);

  let deleted = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      await deleteFileRef(file._id);
      deleted++;
    } catch (err) {
      const msg = `Failed to delete ${file._id} (${file.name}): ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `archive-cleanup: deleted ${deleted}/${files.length} files${errors.length ? `, ${errors.length} errors` : ""}`,
  );

  return Response.json({ deleted, total: files.length, errors });
}
