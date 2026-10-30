/**
 * A letter's recording, read aloud (Austin, 2026-10-27): the queue half.
 * The guide's browser records and uploads; the worker makes the
 * `.web.mp4` the CLI's `nopal video prep` makes, then the poster
 * (`letterRecording.server.ts`, which only the worker imports: ffmpeg
 * never runs in the app, ADR-021). This module is the queue and the
 * status, with no ffmpeg in it, so the app can ask.
 *
 * Its own queue, not the media queue: a transcode takes minutes and the
 * media queue's one slot makes everyone's posters.
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

export const LETTER_RECORDING_QUEUE_NAME = "letter-recording";

export type LetterRecordingJobData = { fileId: string };
export type LetterRecordingJobResult = { s3Key: string; size: number; poster: boolean } | { skipped: string };

let queue: Queue<LetterRecordingJobData, LetterRecordingJobResult, string> | undefined;
function getQueue(): Queue<LetterRecordingJobData, LetterRecordingJobResult, string> {
  if (!queue) queue = new Queue(LETTER_RECORDING_QUEUE_NAME, { connection: getConnection() });
  return queue;
}

const JOB_OPTIONS = {
  attempts: 2,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export function letterRecordingJobId(fileId: string): string {
  return `recording-${fileId}`;
}

/** Asks the worker to prepare one recording, unless it already is. */
export async function enqueueLetterRecording(fileId: string): Promise<string> {
  const jobId = letterRecordingJobId(fileId);
  const q = getQueue();
  const existing = await q.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) === "failed") await existing.remove();
    else return jobId;
  }
  await q.add("prepare", { fileId }, { ...JOB_OPTIONS, jobId });
  return jobId;
}

/** What the record control shows after an upload, so nobody reads the
 * worker's log: on its way, ready, or failed with the worker's reason. */
export type LetterRecordingState = { state: "preparing" } | { state: "ready" } | { state: "failed"; reason: string } | { state: "none" };

export function recordingStateFromJob(job: { state: string; failedReason?: string; returnvalue?: unknown } | null): LetterRecordingState {
  if (!job) return { state: "none" };
  if (job.state === "completed") {
    const r = job.returnvalue;
    if (r && typeof r === "object" && "skipped" in r) return { state: "failed", reason: String((r as { skipped: unknown }).skipped) };
    return { state: "ready" };
  }
  if (job.state === "failed") return { state: "failed", reason: job.failedReason || "the worker gave no reason" };
  return { state: "preparing" };
}

export async function letterRecordingState(fileId: string): Promise<LetterRecordingState> {
  const job = await getQueue().getJob(letterRecordingJobId(fileId));
  if (!job) return recordingStateFromJob(null);
  return recordingStateFromJob({ state: await job.getState(), failedReason: job.failedReason, returnvalue: job.returnvalue });
}
