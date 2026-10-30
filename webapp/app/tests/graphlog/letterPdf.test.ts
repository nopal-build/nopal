/**
 * A letter's PDF is the public page printed, keyed by the sent copy's
 * hash (`letterPdf.server.ts`; by the draft's until 2026-10-28): the
 * key moves with a send and never with an edit, the job id is one
 * BullMQ accepts, and a file from before hashing still gets a key.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LETTER_PDF_RENDER_VERSION, letterPdfFileName, letterPdfJobId, letterPdfKey, pdfFingerprint, pdfStateFromJob } from "robustness-core/data/letterPdf.server";

describe("the PDF's key", () => {
  it("sits under the letter's id and changes with the content hash and the render version (2026-10-29)", () => {
    expect(letterPdfKey("d3l1v", "abc")).toBe(`letters/d3l1v/abc-r${LETTER_PDF_RENDER_VERSION}.pdf`);
    expect(letterPdfKey("d3l1v", "abc")).not.toBe(letterPdfKey("d3l1v", "abd"));
    expect(letterPdfKey("d3l1v", "abc")).not.toBe(letterPdfKey("d3l1w", "abc"));
  });

  it("is a job id with no colon in it", () => {
    expect(letterPdfJobId("d3l1v", "abc")).toBe(`pdf-d3l1v-abc-r${LETTER_PDF_RENDER_VERSION}`);
    expect(letterPdfJobId("d3l1v", "abc")).not.toContain(":");
  });

  it("is the sent copy's hash, and moves with a send, not an edit", () => {
    const sent = { content: "# A", content_hash: "draft", sent_content: "# A", sent_content_hash: "sent", sent_at: "2026-10-28T10:00:00Z", sent_date: "2026-10-28", sent_count: 1 };
    expect(pdfFingerprint(sent)).toBe("sent");
    expect(pdfFingerprint({ ...sent, content: "# A edited", content_hash: "draft2" })).toBe("sent");
    expect(pdfFingerprint({ ...sent, sent_content: "# A edited", sent_content_hash: "sent2" })).toBe("sent2");
    const expected = createHash("sha256").update("# A", "utf8").digest("hex");
    expect(pdfFingerprint({ ...sent, sent_content_hash: null })).toBe(expected);
  });

  it("falls back to the draft's hash for a letter never sent, hashing the content when a record has none", () => {
    expect(pdfFingerprint({ content: "# A", content_hash: "stored" })).toBe("stored");
    const expected = createHash("sha256").update("# A", "utf8").digest("hex");
    expect(pdfFingerprint({ content: "# A", content_hash: null })).toBe(expected);
    expect(pdfFingerprint({ content: "# A", content_hash: undefined })).toBe(expected);
  });

  it("names the download after the markdown file", () => {
    expect(letterPdfFileName("madison-attic.md")).toBe("madison-attic.pdf");
    expect(letterPdfFileName("notes")).toBe("notes.pdf");
  });
});

describe("what the tab says about the PDF", () => {
  it("is ready when the file is in storage, whatever the queue says", () => {
    expect(pdfStateFromJob(true, null)).toEqual({ state: "ready" });
    expect(pdfStateFromJob(true, { state: "failed", failedReason: "old" })).toEqual({ state: "ready" });
  });

  it("is preparing while the job waits or runs, and nothing when nobody asked", () => {
    for (const state of ["waiting", "active", "delayed", "prioritized"]) expect(pdfStateFromJob(false, { state })).toEqual({ state: "preparing" });
    expect(pdfStateFromJob(false, null)).toEqual({ state: "none" });
  });

  it("carries the worker's own reason when it failed or skipped, with the time", () => {
    expect(pdfStateFromJob(false, { state: "failed", failedReason: "browserType.launch: Executable doesn't exist", finishedOn: Date.UTC(2026, 9, 21, 15) })).toEqual({
      state: "failed",
      reason: "browserType.launch: Executable doesn't exist",
      at: "2026-10-21T15:00:00.000Z",
    });
    expect(pdfStateFromJob(false, { state: "failed" })).toMatchObject({ state: "failed", reason: "the worker gave no reason", at: null });
    expect(pdfStateFromJob(false, { state: "completed", returnvalue: { skipped: "the link is off" } })).toMatchObject({ state: "failed", reason: "the link is off" });
    expect(pdfStateFromJob(false, { state: "completed", returnvalue: { s3Key: "k", size: 1 } })).toEqual({ state: "none" });
  });
});
