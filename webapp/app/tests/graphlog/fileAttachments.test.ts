// Regression tests for the "files never reached the README" fix: an
// attached photo/PDF now flows daily-log-sync -> sync-graph -> a node's
// own text -> graph-structure -> graph-project-view, automatically, with
// no separate plumbing at any later stage.

import { describe, it, expect } from "vitest";
import {
  parseSyncedAttachmentFileName,
  parseSyncedCardFileName,
  syncedAttachmentFileName,
} from "robustness-core/data/dailyLogSync.server";
import { capNodeLinks } from "robustness-core/data/syncGraph.server";
import { extractFileAttachments } from "robustness-core/data/sorter.server";
import { extractFileDirectives, type GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import { buildFileDirectiveMarkdown } from "oxmarkdown-core";

// capNodeLinks is imported only to confirm the module still loads cleanly
// alongside the new file-handling code in the same file (a cheap smoke
// check, not a real assertion about links).
void capNodeLinks;

describe("attachment filename parsing", () => {
  it("parses a Card's own synced text file", () => {
    expect(parseSyncedCardFileName("2026-08-14-h123.md")).toEqual({ date: "2026-08-14", humanId: "h123" });
  });

  it("does not mistake an attachment for a Card's own text file", () => {
    expect(parseSyncedCardFileName("2026-08-14-h123-IMG_1523.jpeg")).toBeNull();
  });

  it("parses a synced attachment's filename back into date/humanId/originalName", () => {
    expect(parseSyncedAttachmentFileName("2026-08-14-h123-IMG_1523.jpeg")).toEqual({
      date: "2026-08-14",
      humanId: "h123",
      originalName: "IMG_1523.jpeg",
    });
  });

  it("does not mistake a Card's own text file for an attachment", () => {
    expect(parseSyncedAttachmentFileName("2026-08-14-h123.md")).toBeNull();
  });

  it("round-trips an original name that itself contains hyphens", () => {
    const parsed = parseSyncedAttachmentFileName("2026-08-14-h123-whiteboard-photo-1.jpg");
    expect(parsed).toEqual({ date: "2026-08-14", humanId: "h123", originalName: "whiteboard-photo-1.jpg" });
  });
});

describe("::file{...} directive", () => {
  it("builds a real, parseable directive from a fileId/name", () => {
    const markdown = buildFileDirectiveMarkdown({ fileId: "abc123", name: "IMG_1523.jpeg" });
    expect(markdown).toBe('::file{fileId="abc123" name="IMG_1523.jpeg"}');
  });

  it("extractFileDirectives finds a directive embedded in a node's own quote", () => {
    const quote = "==The whiteboard shows three columns: build, ship, learn.==\n\n::file{fileId=\"abc123\" name=\"whiteboard.jpg\"}";
    expect(extractFileDirectives(quote)).toEqual(['::file{fileId="abc123" name="whiteboard.jpg"}']);
  });

  it("returns nothing for a node with no attached file", () => {
    expect(extractFileDirectives("==Just words, no file here.==")).toEqual([]);
  });
});

describe("a human-written caption is real content, independent of AI", () => {
  it("extractFileAttachments recovers the uploader's own caption from a Card's markdown", () => {
    const cardContent = '::file{fileId="abc123" name="IMG_1614.jpeg" caption="South wall, before starting the electrical."}';
    const [attachment] = extractFileAttachments(cardContent);
    expect(attachment.caption).toBe("South wall, before starting the electrical.");
  });

  it("a caption survives round-tripping through the synced attachment name (sync-graph's own matching key)", () => {
    // Mirrors exactly what `syncGraph.server.ts`'s own
    // `captionByAttachmentName` map does: recover the caption from the
    // Card's `::file{...}`, key it by the attachment's SYNCED name, then
    // look it up again by that same synced name (`candidate.name`).
    const cardContent = '::file{fileId="abc123" name="IMG_1614.jpeg" caption="South wall, before starting the electrical."}';
    const [attachment] = extractFileAttachments(cardContent);
    const captionByAttachmentName = new Map<string, string>();
    captionByAttachmentName.set(
      syncedAttachmentFileName("2026-08-25", "h123", attachment.name),
      attachment.caption,
    );
    expect(captionByAttachmentName.get("2026-08-25-h123-IMG_1614.jpeg")).toBe(
      "South wall, before starting the electrical.",
    );
  });

  it("buildFileDirectiveMarkdown carries the caption into the final directive", () => {
    const markdown = buildFileDirectiveMarkdown({
      fileId: "abc123",
      name: "IMG_1614.jpeg",
      caption: "South wall, before starting the electrical.",
    });
    expect(markdown).toBe(
      '::file{fileId="abc123" name="IMG_1614.jpeg" caption="South wall, before starting the electrical."}',
    );
  });

  it("omits the caption attribute entirely when there is none", () => {
    const markdown = buildFileDirectiveMarkdown({ fileId: "abc123", name: "IMG_1614.jpeg" });
    expect(markdown).not.toContain("caption");
  });

  it("a file with no caption and no description attribute given still parses fine", () => {
    const cardContent = '::file{fileId="abc123" name="IMG_1614.jpeg"}';
    const [attachment] = extractFileAttachments(cardContent);
    expect(attachment.caption).toBe("");
  });
});

describe("a node's file is part of its permanent text (no separate field needed)", () => {
  it("a node's own quote carries the file directive end to end", () => {
    // Simulates what `add_node`'s executor produces once a file-backed
    // source is cited: quote body + file directive, joined the same way
    // `renderQuoteBlocks`/`add_node` already join setup + quote.
    const fileDirective = buildFileDirectiveMarkdown({ fileId: "abc123", name: "whiteboard.jpg" });
    const quote = ["==The whiteboard shows three columns.==", fileDirective].join("\n\n");
    const node: GraphLogNode = {
      id: "2026-08-14#1",
      date: "2026-08-14",
      number: 1,
      quote,
      authorName: "Austin T",
      authorHumanId: "h123",
      refLine: ':ref{name="Austin T" datetime="2026-08-14T12:00:00Z" location="/x" verbose="true"}',
      links: [],
    };
    // Whatever later reads `node.quote` (graph-structure's pre-fetch,
    // graph-project-view's node text) sees the file automatically --
    // no new field on GraphLogNode was needed for this to work.
    expect(extractFileDirectives(node.quote)).toHaveLength(1);
    expect(node.quote).toContain(fileDirective);
  });
});
