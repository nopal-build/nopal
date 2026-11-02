/**
 * The worker's half of a letter's PDF (`letterPdf.server.ts`
 * has the queue and the key): typeset the sent markdown directly with
 * Typst (`typst compile`, a native static binary — `crates/` has no
 * part in this, see `typstBinary()`) and upload the result. Imported by
 * `packages/worker/worker.ts` and nothing in the web app (ADR-021;
 * `noMediaProcessingInApp.test.ts`).
 *
 * Replaces printing the live public page in headless Chromium
 * (2026-11-02; see the `oxmarkdown-pdf-via-typst` garden seed for the
 * full before/after). The sent copy's own content (`sentCopyOf`) is
 * read directly — no HTTP round-trip to the app, no render pass, no
 * browser. `letterRenderPass.server.ts` existed only to let that round-
 * trip through when the letter's link was off; nothing needs it now.
 *
 * The paper is set here and nowhere else: Letter, 0.6in margins, and a
 * page number centred in the bottom margin, nothing else in the margins
 * (Austin, 2026-10-27: page numbers, no header) — the exact same rule
 * `LETTER_PDF_OPTIONS` encoded for Chromium, just as a Typst page rule
 * now. A letter whose body opens with its own heading shows no second,
 * synthesized title (`bodyOpensWithTitle`, unchanged from the public
 * page's own rule); otherwise the title and send date print above the
 * body, same information the public page's own header carries.
 *
 * `::video{...}`/`::LoadCellGraph{...}` directives can't be typeset (no
 * player, no chart) — `renderOxDocumentToTypst` already turns each into
 * a short italic placeholder line rather than an error; see that
 * module's own docstring for the V1 scope decision and the QR-code
 * direction being saved for later. An image that fails to resolve
 * (deleted from the vault, a transient S3 error) gets the same
 * treatment here rather than failing the whole PDF.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { parseOxDocument, renderOxDocumentToTypst, escapeTypstText } from "oxmarkdown-core";
import { letterPdfKey, pdfFingerprint, type LetterPdfJobData, type LetterPdfJobResult } from "./letterPdf.server";
import { bodyOpensWithTitle, letterTitle, resolveSentLetter, sentCopyOf } from "./letters.server";
import { splitFrontmatter } from "./project.types";
import { downloadFileBytes, uploadPrivateFileToS3 } from "./file.server";
import { getFileRefById } from "./vault.server";

const run = promisify(execFile);

/** Overridable for a packaged/deployed image (the worker's own
 * Dockerfile downloads the real release binary into this path); the
 * default, bare `typst`, is all local dev needs once installed on
 * `PATH` (`brew install typst` locally). Unlike `crates/heic-decode`,
 * nothing here compiles Typst from source — it ships a single static
 * binary with no shared-library dependencies, so there's no crate, no
 * build stage, just a download. */
export function typstBinary(): string {
  return process.env.TYPST_BIN || "typst";
}

/** The page rule: Letter, 0.6in all round, the page number alone in
 * the footer, drawn in Typst's own default font (bundled, guaranteed
 * present wherever `typst` runs — no font-matching risk the way naming
 * a system font like the page's own CSS stack would carry here). */
const PAGE_PREAMBLE = `#set page(
  paper: "us-letter",
  margin: 0.6in,
  header: none,
  footer: context [
    #set align(center)
    #set text(size: 9pt, fill: rgb("#3f2b46"))
    #counter(page).display()
  ],
)
#set text(size: 11pt)`;

/** One Image call's worth of source text, exactly as
 * `renderOxDocumentToTypst` wrote it — used both to know what to WRITE
 * (the resolved bytes, at this path) and, on a resolution failure, what
 * to find-and-replace with a short note instead. */
function imageCallText(placeholder: string): string {
  return `#image("${placeholder}", width: 100%)`;
}

/** The sent copy's title and send date, as the public page's own
 * header shows them (`letterPage`) — printed above the body unless the
 * body already opens with its own `# ` heading. */
function letterHeader(title: string, body: string, dateLabel: string, resent: boolean): string {
  const titleLine = bodyOpensWithTitle(body) ? "" : `= ${escapeTypstText(title)}`;
  const sentLine = `#text(size: 9pt, fill: rgb("#6b7280"))[Sent ${escapeTypstText(dateLabel)}${resent ? " \u00b7 updated" : ""}]`;
  return [titleLine, sentLine].filter((s) => s.length > 0).join("\n\n");
}

/** One letter image, normalized to JPEG regardless of its original
 * format (same "decode once, re-encode to one format" convention
 * `attachmentFrames.server.ts`'s `heicToJpeg` already uses) — `null` on
 * anything that stops it (file gone, no `s3_key`, bytes Sharp can't
 * read), so one bad reference degrades to a placeholder note instead of
 * failing the whole PDF. */
async function resolveLetterImage(fileId: string): Promise<Buffer | null> {
  try {
    const file = await getFileRefById(fileId);
    if (!file?.s3_key) return null;
    const bytes = await downloadFileBytes(file.s3_key);
    return await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}

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
  const sentCopy = sentCopyOf(sent.file);
  if (!sentCopy) return { skipped: "not sent, or no longer a letter" };

  const { body } = splitFrontmatter(sentCopy.content);
  const doc = parseOxDocument(body);
  const { typst, images } = renderOxDocumentToTypst(doc);

  const title = letterTitle({ name: sent.file.name, content: sentCopy.content });
  const dateLabel = new Date(`${sentCopy.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const header = letterHeader(title, body, dateLabel, sentCopy.count > 1);

  const s3Key = letterPdfKey(data.fileId, data.contentHash);
  const dir = await mkdtemp(join(tmpdir(), "letter-pdf-"));
  try {
    let source = [PAGE_PREAMBLE, header, typst].filter((s) => s.length > 0).join("\n\n");
    for (const ref of images) {
      const jpeg = await resolveLetterImage(ref.fileId);
      if (jpeg) {
        await writeFile(join(dir, ref.placeholder), jpeg);
      } else {
        log(`image ${ref.fileId} could not be read; printing a placeholder instead`);
        source = source.replace(imageCallText(ref.placeholder), "_(image unavailable)_");
      }
    }
    const typPath = join(dir, "letter.typ");
    const pdfPath = join(dir, "letter.pdf");
    await writeFile(typPath, source, "utf8");

    log(`compiling ${typPath}`);
    try {
      await run(typstBinary(), ["compile", "letter.typ", "letter.pdf"], { cwd: dir, maxBuffer: 1 << 22 });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr;
      throw new Error(stderr?.trim() || String(e));
    }

    const pdf = await readFile(pdfPath);
    await uploadPrivateFileToS3(pdf, s3Key);
    log(`wrote ${s3Key} (${pdf.length} bytes)`);
    return { s3Key, size: pdf.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
