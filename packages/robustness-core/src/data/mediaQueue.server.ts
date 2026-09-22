/**
 * The media queue: one job per uploaded file, asking the worker to make
 * its renditions (`mediaRenditions.server.ts`). Enqueued by the upload
 * routes the moment a file lands, so a fresh photo's thumbnail exists
 * seconds later; sync-knowledge backfills anything older on a project's
 * next run. Same shape as `publicZip.server.ts`'s queue: its own name,
 * the shared Redis, the worker in `packages/worker/worker.ts`.
 *
 * The web server never processes media (Austin, 2026-09-22): this queue
 * is the whole of what the app does about a rendition.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: IORedis | undefined;
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  }
  return connection;
}

export const MEDIA_QUEUE_NAME = "media";

export type MediaJobName = "renditions";
export type MediaJobData = { fileId: string };

let queue: Queue<MediaJobData, unknown, MediaJobName> | undefined;
function getMediaQueue(): Queue<MediaJobData, unknown, MediaJobName> {
  if (!queue) queue = new Queue(MEDIA_QUEUE_NAME, { connection: getConnection() });
  return queue;
}

const JOB_OPTIONS = {
  attempts: 2,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/** Asks the worker for one file's renditions. Idempotent by file: a
 * second upload of the same file id is one job. */
export async function enqueueRenditionsJob(fileId: string): Promise<string> {
  const job = await getMediaQueue().add("renditions", { fileId }, { ...JOB_OPTIONS, jobId: `renditions-${fileId}` });
  return job.id ?? `renditions-${fileId}`;
}
