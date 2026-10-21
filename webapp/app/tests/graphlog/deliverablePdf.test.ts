/**
 * A deliverable's PDF is the public page printed, keyed by the file's
 * content hash (`deliverablePdf.server.ts`, 2026-10-21): the key moves
 * with the content, the job id is one BullMQ accepts, and a file from
 * before hashing still gets a key.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliverablePdfFileName, deliverablePdfJobId, deliverablePdfKey, pdfFingerprint } from "robustness-core/data/deliverablePdf.server";

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
