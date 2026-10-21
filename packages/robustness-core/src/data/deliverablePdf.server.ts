/**
 * A deliverable's PDF: the public page printed (Austin, 2026-10-21: "an
 * output option for the displayed page, nothing more"). The worker opens
 * `/public/deliverable/<fileId>` in a headless browser and saves what it
 * sees (`deliverablePdfRender.server.ts`, which only the worker imports;
 * the web server never renders, ADR-021). This module is the queue, the
 * key and the status, with no browser in it, so the app can ask for a
 * PDF without carrying a browser driver into its bundle.
 *
 * Keyed by the file's content hash (`deliverables/<fileId>/<hash>.pdf`):
 * a replace makes a new one, an unchanged file reuses the old one, the
 * same "live" rule the page follows. Rendered ahead of the click, when
 * the link turns on and after each replace while shared, so the click
 * is instant; a click that finds none enqueues and waits (the route
 * shows a page that refreshes itself). Same enqueue-then-serve shape as
 * `publicZip.server.ts`: the job id doubles as the cache key, and BullMQ
 * keeps a finished job for a day so a repeat ask converges on it.
 *
 * A PDF only exists while the link is on: the worker reaches the page
 * through the public URL, and re-checks the share before writing.
 */

import crypto from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { deliverableHome, isDeliverableShared, isMarkdownFileName } from "./deliverables.server";
import { objectExists } from "./file.server";
import type { FileRef } from "./vault.types";

let connection: IORedis | undefined;
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  }
  return connection;
}

export const DELIVERABLE_PDF_QUEUE_NAME = "deliverable-pdf";

export type DeliverablePdfJobData = { fileId: string; contentHash: string };
export type DeliverablePdfJobResult = { s3Key: string; size: number } | { skipped: string };

let queue: Queue<DeliverablePdfJobData, DeliverablePdfJobResult, string> | undefined;
function getQueue(): Queue<DeliverablePdfJobData, DeliverablePdfJobResult, string> {
  if (!queue) queue = new Queue(DELIVERABLE_PDF_QUEUE_NAME, { connection: getConnection() });
  return queue;
}

const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 60 * 60 },
};

/** What the PDF is keyed by: the stored content hash, else a hash of the
 * content itself (records from before hashing have none). */
export function pdfFingerprint(file: Pick<FileRef, "content" | "content_hash">): string {
  return file.content_hash ?? crypto.createHash("sha256").update(file.content ?? "", "utf8").digest("hex");
}

/** Where the PDF for one version of the file lives. */
export function deliverablePdfKey(fileId: string, contentHash: string): string {
  return `deliverables/${fileId}/${contentHash}.pdf`;
}

/** No `:`: BullMQ uses it as its own key delimiter and refuses it in a
 * custom id. */
export function deliverablePdfJobId(fileId: string, contentHash: string): string {
  return `pdf-${fileId}-${contentHash}`;
}

/** Asks the worker for this version's PDF unless the same ask is already
 * waiting, running or done. A failed one is removed and asked again. */
export async function ensureDeliverablePdfJob(file: Pick<FileRef, "_id" | "content" | "content_hash">): Promise<string> {
  const contentHash = pdfFingerprint(file);
  const jobId = deliverablePdfJobId(file._id, contentHash);
  const q = getQueue();
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") await existing.remove();
    else return jobId;
  }
  await q.add("render", { fileId: file._id, contentHash }, { ...JOB_OPTIONS, jobId });
  return jobId;
}

export type DeliverablePdfStatus = { ready: true; s3Key: string } | { ready: false; s3Key: string };

/** Whether this version's PDF is in storage. */
export async function deliverablePdfStatus(file: Pick<FileRef, "_id" | "content" | "content_hash">): Promise<DeliverablePdfStatus> {
  const s3Key = deliverablePdfKey(file._id, pdfFingerprint(file));
  return { ready: await objectExists(s3Key), s3Key };
}

/** The hook the share switch and the replace route call: a render ahead
 * of the click, only for a shared markdown deliverable. Returns the job
 * id, or null when nothing was asked for. */
export async function enqueueDeliverablePdfIfShared(file: FileRef | null | undefined): Promise<string | null> {
  if (!file || !isDeliverableShared(file) || file.archived_at || !isMarkdownFileName(file.name)) return null;
  if (!(await deliverableHome(file))) return null;
  return ensureDeliverablePdfJob(file);
}

/** The file name the download carries: the markdown name with `.pdf`. */
export function deliverablePdfFileName(name: string): string {
  return `${name.replace(/\.md$/i, "")}.pdf`;
}

/** What the PDF route shows while the worker prints: a plain page that
 * refreshes itself until the download takes over. No script, nothing to
 * click; the one word to the reader is that it is on its way. */
export function preparingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3">
<title>Preparing the PDF</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #333; background: #fff; }
  p { max-width: 28rem; text-align: center; line-height: 1.5; }
  small { color: #777; }
</style>
</head>
<body>
<p>Preparing the PDF.<br><small>This takes a few seconds. The page checks again on its own.</small></p>
</body>
</html>
`;
}
