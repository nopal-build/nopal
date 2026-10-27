/**
 * The worker's half of a letter's PDF (`letterPdf.server.ts`
 * has the queue and the key): open the public page in headless Chromium
 * and print it. Imported by `packages/worker/worker.ts` and nothing in
 * the web app: the app does not declare `playwright-core`, and Vite
 * inlines what an app merely reaches, so this file must never be on an
 * app route's import path (ADR-021; `noMediaProcessingInApp.test.ts`).
 *
 * The page is the only renderer. Nothing here knows markdown: the
 * worker sees what a contractor with the link sees, in the light scheme
 * (a PDF is paper), on Letter, with the page's own print rules applied
 * (`page.pdf` renders under print media), which hide the download links
 * so the file carries no button to itself.
 *
 * One browser per job, closed whatever happens. Chromium holds a few
 * hundred MB for a page like this and the worker has 1 GB, so the worker
 * runs one render at a time (`worker.ts`); a render is rare, one per
 * share or replace.
 */

import { chromium } from "playwright-core";
import { letterPdfKey, pdfFingerprint, type LetterPdfJobData, type LetterPdfJobResult } from "./letterPdf.server";
import { letterPublicPath, resolveSharedLetter } from "./letters.server";
import { uploadPrivateFileToS3 } from "./file.server";

/** Where the worker finds the app: `https://o.nopal.build` in
 * production (`packages/worker/fly.toml`), `http://fruits:3000` in the
 * dev stack (`docker-compose.yml`). */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) throw new Error("APP_BASE_URL is not set on the worker; it names the app the PDF is printed from");
  return url.replace(/\/$/, "");
}

export async function renderLetterPdf(
  data: LetterPdfJobData,
  log: (line: string) => void = () => {},
): Promise<LetterPdfJobResult> {
  // Re-checked here, not trusted from whoever enqueued: the link may have
  // gone off, or the file changed, between the ask and this job.
  const shared = await resolveSharedLetter(data.fileId);
  if (!shared) return { skipped: "the link is off, or this is no longer a letter" };
  const currentHash = pdfFingerprint(shared.file);
  if (currentHash !== data.contentHash) return { skipped: "superseded: the file changed since this render was asked for" };

  const url = `${appBaseUrl()}${letterPublicPath(data.fileId)}`;
  const s3Key = letterPdfKey(data.fileId, data.contentHash);
  log(`rendering ${url}`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      colorScheme: "light",
      extraHTTPHeaders: { "sec-ch-prefers-color-scheme": "light" },
      viewport: { width: 960, height: 1280 },
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!response || !response.ok()) throw new Error(`the public page answered ${response?.status() ?? "nothing"}`);
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.6in", right: "0.6in", bottom: "0.6in", left: "0.6in" },
    });
    await uploadPrivateFileToS3(pdf, s3Key);
    log(`wrote ${s3Key} (${pdf.length} bytes)`);
    return { s3Key, size: pdf.length };
  } finally {
    await browser.close();
  }
}
