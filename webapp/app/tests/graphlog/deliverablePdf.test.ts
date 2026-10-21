/**
 * A deliverable's PDF is the public page printed, keyed by the file's
 * content hash (`deliverablePdf.server.ts`, 2026-10-21): the key moves
 * with the content, the job id is one BullMQ accepts, and a file from
 * before hashing still gets a key.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliverablePdfFileName, deliverablePdfJobId, deliverablePdfKey, pdfFingerprint, pdfStateFromJob } from "robustness-core/data/deliverablePdf.server";

describe("the PDF's key", () => {
  it("sits under the deliverable's id and changes with the content hash", () => {
    expect(deliverablePdfKey("d3l1v", "abc")).toBe("deliverables/d3l1v/abc.pdf");
    expect(deliverablePdfKey("d3l1v", "abc")).not.toBe(deliverablePdfKey("d3l1v", "abd"));
    expect(deliverablePdfKey("d3l1v", "abc")).not.toBe(deliverablePdfKey("d3l1w", "abc"));
  });

  it("is a job id with no colon in it", () => {
    expect(deliverablePdfJobId("d3l1v", "abc")).toBe("pdf-d3l1v-abc");
    expect(deliverablePdfJobId("d3l1v", "abc")).not.toContain(":");
  });

  it("uses the stored content hash, and hashes the content when a record has none", () => {
    expect(pdfFingerprint({ content: "# A", content_hash: "stored" })).toBe("stored");
    const expected = createHash("sha256").update("# A", "utf8").digest("hex");
    expect(pdfFingerprint({ content: "# A", content_hash: null })).toBe(expected);
    expect(pdfFingerprint({ content: "# A", content_hash: undefined })).toBe(expected);
  });

  it("names the download after the markdown file", () => {
    expect(deliverablePdfFileName("madison-attic.md")).toBe("madison-attic.pdf");
    expect(deliverablePdfFileName("notes")).toBe("notes.pdf");
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
