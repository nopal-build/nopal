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
 * (`page.pdf` renders under print media, so `oxmarkdown.css`'s paper
 * block sets the type and Stamps' `hideInPrint` drops the download
 * links). A sent letter whose link is off is read under a render pass
 * (`letterRenderPass.server.ts`), carried as a header on the app's own
 * requests only, opened before the page and closed after.
 *
 * The paper is set here and nowhere else: Letter, 0.6in margins, and a
 * page number centred in the bottom margin, nothing else in the margins
 * (Austin, 2026-10-27: page numbers, no header). The number is
 * Chromium's footer template rather than a stylesheet `@page` rule,
 * because `@page` can't be scoped to `.ox-content` and would reach
 * every page that loads `oxmarkdown.css`.
 *
 * One browser per job, closed whatever happens. Chromium holds a few
 * hundred MB for a page like this and the worker has 1 GB, so the worker
 * runs one render at a time (`worker.ts`); a render is rare, one per
 * share or replace.
 */

import { chromium } from "playwright-core";
import { letterPdfKey, pdfFingerprint, type LetterPdfJobData, type LetterPdfJobResult } from "./letterPdf.server";
import { letterPublicPath, resolveSentLetter } from "./letters.server";
import { closeRenderPass, LETTER_RENDER_HEADER, openRenderPass } from "./letterRenderPass.server";
import { uploadPrivateFileToS3 } from "./file.server";

/** Where the worker finds the app: `https://o.nopal.build` in
 * production (`packages/worker/fly.toml`), `http://fruits:3000` in the
 * dev stack (`docker-compose.yml`). */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) throw new Error("APP_BASE_URL is not set on the worker; it names the app the PDF is printed from");
  return url.replace(/\/$/, "");
}

/** The paper (`page.pdf`): Letter, 0.6in all round, the page number
 * alone in the footer. The template is drawn by Chromium outside the
 * page, so it gets none of the page's fonts or colours; `--purple`'s
 * value is written out, and 9pt keeps it below the body's 11.5pt. */
export const LETTER_PDF_OPTIONS = {
  format: "Letter",
  printBackground: true,
  margin: { top: "0.6in", right: "0.6in", bottom: "0.6in", left: "0.6in" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;text-align:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:9pt;color:#3f2b46;"><span class="pageNumber"></span></div>',
} as const;

export async function renderLetterPdf(
  data: LetterPdfJobData,
  log: (line: string) => void = () => {},
): Promise<LetterPdfJobResult> {
  // Re-checked here, not trusted from whoever enqueued: the letter may
  // have been archived, or sent again, between the ask and this job.
  const sent = await resolveSentLetter(data.fileId);
  if (!sent) return { skipped: "not sent, or no longer a letter" };
  const currentHash = pdfFingerprint(sent.file);
  if (currentHash !== data.contentHash) return { skipped: "superseded: the file changed since this render was asked for" };

  const origin = appBaseUrl();
  const url = `${origin}${letterPublicPath(data.fileId)}`;
  const s3Key = letterPdfKey(data.fileId, data.contentHash);
  log(`rendering ${url}`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  let pass: string | null = null;
  try {
    pass = await openRenderPass(data.fileId);
    const header = { [LETTER_RENDER_HEADER]: pass };
    const context = await browser.newContext({
      colorScheme: "light",
      extraHTTPHeaders: { "sec-ch-prefers-color-scheme": "light" },
      viewport: { width: 960, height: 1280 },
    });
    // The pass goes to the app only, never to storage or anything the
    // page's pictures redirect to.
    await context.route("**/*", (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== new URL(origin).origin) return route.continue();
      return route.continue({ headers: { ...request.headers(), ...header } });
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!response || !response.ok()) throw new Error(`the public page answered ${response?.status() ?? "nothing"}`);
    const pdf = await page.pdf({ ...LETTER_PDF_OPTIONS, margin: { ...LETTER_PDF_OPTIONS.margin } });
    await uploadPrivateFileToS3(pdf, s3Key);
    log(`wrote ${s3Key} (${pdf.length} bytes)`);
    return { s3Key, size: pdf.length };
  } finally {
    await browser.close();
    if (pass) await closeRenderPass(pass);
  }
}
