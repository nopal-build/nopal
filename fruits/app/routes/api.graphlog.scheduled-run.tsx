import type { ActionFunctionArgs } from "react-router";
import { getGraphLogScheduledFolders } from "robustness-core/data/graphLogSchedule.server";
import { enqueueGraphLogJob, getGraphLogProjectStatus } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/scheduled-run
 *
 * Enqueues a normal GraphLog `"run"` job for every `project-n02` folder
 * currently enrolled in the daily automatic run (see
 * `graphLogSchedule.server.ts`). Protected by the same CRON_SECRET
 * environment variable as `api.vault.trash-cleanup.tsx`/
 * `api.vault.archive-cleanup.tsx` — wired into the server's own daily
 * cron (see server.js), anchored to local midnight rather than "once
 * every 24h from server start" like those two, since the whole point
 * here is "at midnight".
 *
 * `runGraphLogPipeline` needs no separate "fresh vs incremental" flag:
 * every stage already decides that for itself from what's already on
 * disk, so a brand new or just-reset project does a full first pass here
 * and an existing one only picks up what's new — see
 * `graphLogSchedule.server.ts`'s module doc.
 *
 * Each project is enqueued as its own independent job, `actingHumanId`
 * set to the project's own owner (`human_id`) since no human is actually
 * initiating this run. One project failing to enqueue doesn't stop the
 * rest.
 *
 * You can also trigger it manually:
 *
 *   curl -X POST https://<your-app>.fly.dev/api/graphlog/scheduled-run \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("graphlog/scheduled-run: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const folders = await getGraphLogScheduledFolders();

  let enqueued = 0;
  let skippedAlreadyRunning = 0;
  const errors: string[] = [];

  for (const folder of folders) {
    try {
      // A human may have kicked off a manual Run/Reset (or a previous
      // night's scheduled run may have overrun into this one) -- skip
      // rather than piling a second job in behind it.
      const status = await getGraphLogProjectStatus(folder._id);
      if (status.running) {
        skippedAlreadyRunning++;
        continue;
      }
      await enqueueGraphLogJob("run", {
        actingHumanId: folder.human_id,
        projectFolderId: folder._id,
      });
      enqueued++;
    } catch (err) {
      const msg = `Failed to enqueue ${folder._id} (${folder.name}): ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `graphlog/scheduled-run: enqueued ${enqueued}/${folders.length} project(s)${skippedAlreadyRunning ? `, ${skippedAlreadyRunning} already running` : ""}${errors.length ? `, ${errors.length} errors` : ""}`,
  );

  return Response.json({ enqueued, total: folders.length, skippedAlreadyRunning, errors });
}
