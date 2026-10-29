/**
 * A letter's PDF: the public page printed (Austin, 2026-10-21: "an
 * output option for the displayed page, nothing more"). The worker opens
 * `/public/letter/<fileId>` in a headless browser and saves what it
 * sees (`letterPdfRender.server.ts`, which only the worker imports;
 * the web server never renders, ADR-021). This module is the queue, the
 * key and the status, with no browser in it, so the app can ask for a
 * PDF without carrying a browser driver into its bundle.
 *
 * Keyed by the file's content hash (`letters/<fileId>/<hash>.pdf`):
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

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { contentFingerprint, isLetterSent, isLetterShared, isMarkdownFileName, letterHome, sentCopyOf, type SentFields } from "./letters.server";
import { objectExists } from "./file.server";
import type { FileRef } from "./vault.types";

let connection: IORedis | undefined;
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  }
  return connection;
}

export const LETTER_PDF_QUEUE_NAME = "letter-pdf";

export type LetterPdfJobData = { fileId: string; contentHash: string };
export type LetterPdfJobResult = { s3Key: string; size: number } | { skipped: string };

let queue: Queue<LetterPdfJobData, LetterPdfJobResult, string> | undefined;
function getQueue(): Queue<LetterPdfJobData, LetterPdfJobResult, string> {
  if (!queue) queue = new Queue(LETTER_PDF_QUEUE_NAME, { connection: getConnection() });
  return queue;
}

const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 60 * 60 },
};

/** A file as the PDF reads it: the sent copy's fields, or the draft's
 * for a letter never sent (which gets no PDF: `enqueueLetterPdfIfShared`). */
export type LetterForPdf = Pick<FileRef, "_id"> & SentFields;

/** What the PDF is keyed by: the sent copy's hash (`sentCopyOf`), which
 * has one writer, `sendLetter`. The draft's hash only for a letter never
 * sent, and such a letter never gets a PDF. */
export function pdfFingerprint(file: Omit<LetterForPdf, "_id">): string {
  return sentCopyOf(file)?.hash ?? contentFingerprint(file);
}

/** Where the PDF for one version of the file lives. */
export function letterPdfKey(fileId: string, contentHash: string): string {
  return `letters/${fileId}/${contentHash}.pdf`;
}

/** No `:`: BullMQ uses it as its own key delimiter and refuses it in a
 * custom id. */
export function letterPdfJobId(fileId: string, contentHash: string): string {
  return `pdf-${fileId}-${contentHash}`;
}

/** Asks the worker for this version's PDF unless the same ask is already
 * waiting, running or done. A failed one is removed and asked again. */
export async function ensureLetterPdfJob(file: LetterForPdf): Promise<string> {
  const contentHash = pdfFingerprint(file);
  const jobId = letterPdfJobId(file._id, contentHash);
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

export type LetterPdfStatus = { ready: true; s3Key: string } | { ready: false; s3Key: string };

/** Whether this version's PDF is in storage. */
export async function letterPdfStatus(file: LetterForPdf): Promise<LetterPdfStatus> {
  const s3Key = letterPdfKey(file._id, pdfFingerprint(file));
  return { ready: await objectExists(s3Key), s3Key };
}

/** The hook the share switch and the send call: a render ahead of the
 * click, only for a sent markdown letter whose link is on. The PDF is of
 * the sent copy, so a saved edit never asks for one (the save and
 * replace routes did until 2026-10-28). Returns the job id, or null
 * when nothing was asked for. */
export async function enqueueLetterPdfIfShared(file: FileRef | null | undefined): Promise<string | null> {
  if (!file || !isLetterShared(file) || !isLetterSent(file) || file.archived_at || !isMarkdownFileName(file.name)) return null;
  if (!(await letterHome(file))) return null;
  return ensureLetterPdfJob(file);
}

/** The file name the download carries: the markdown name with `.pdf`. */
export function letterPdfFileName(name: string): string {
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

/**
 * What a Guide sees on the Letters tab about a shared file's PDF
 * (Austin, 2026-10-21: nobody reads the worker's logs; the outcome
 * belongs on the page that asked for it). Ready when the file is in
 * storage; otherwise what the queue knows: preparing, failed with the
 * worker's own reason, or nothing asked for.
 */
export type LetterPdfState =
  | { state: "ready" }
  | { state: "preparing" }
  | { state: "failed"; reason: string; at: string | null }
  | { state: "none" };

/** The mapping on its own, so the test reads every branch. `job` is
 * what BullMQ knows, or null when no job exists. */
export function pdfStateFromJob(
  ready: boolean,
  job: { state: string; failedReason?: string; finishedOn?: number; returnvalue?: unknown } | null,
): LetterPdfState {
  if (ready) return { state: "ready" };
  if (!job) return { state: "none" };
  if (job.state === "waiting" || job.state === "active" || job.state === "delayed" || job.state === "prioritized") return { state: "preparing" };
  const at = job.finishedOn ? new Date(job.finishedOn).toISOString() : null;
  if (job.state === "failed") return { state: "failed", reason: job.failedReason || "the worker gave no reason", at };
  // Completed without a file: the worker skipped it and said why.
  const skipped = job.returnvalue && typeof job.returnvalue === "object" && "skipped" in job.returnvalue ? String((job.returnvalue as { skipped: unknown }).skipped) : null;
  if (job.state === "completed" && skipped) return { state: "failed", reason: skipped, at };
  return { state: "none" };
}

export async function letterPdfState(fileId: string, contentHash: string): Promise<LetterPdfState> {
  const ready = await objectExists(letterPdfKey(fileId, contentHash));
  if (ready) return { state: "ready" };
  const job = await getQueue().getJob(letterPdfJobId(fileId, contentHash));
  if (!job) return pdfStateFromJob(false, null);
  return pdfStateFromJob(false, { state: await job.getState(), failedReason: job.failedReason, finishedOn: job.finishedOn, returnvalue: job.returnvalue });
}
