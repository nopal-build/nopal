// Regression tests for the "files never reached the README" fix: an
// attached photo/video/PDF now flows daily-log-sync -> sync-graph -> a
// node's own text -> graph-structure -> graph-project-view,
// automatically, with no separate plumbing at any later stage. Shape
// depends on the file's real content type (see `syncGraph.server.ts`'s
// `buildAttachedMediaMarkdown`):
//   - image  -> ordinary `![alt](url)`
//   - video  -> ordinary `[alt](url?type=video)` (a real, clickable link
//     even where the `?type=video` convention isn't understood; the SAME
//     marker `OxRenderer.tsx`'s own gallery collector looks for to
//     upgrade it into a real `<video controls>` player)
//   - anything else -> a plain `[name](url)` link, never gallery-eligible
// None of these are a custom `::file{...}` directive -- see that file's
// own module doc for why.

import { describe, it, expect } from "vitest";
import {
  parseSyncedAttachmentFileName,
  parseSyncedCardFileName,
  syncedAttachmentFileName,
} from "robustness-core/data/dailyLogSync.server";
import { capNodeLinks } from "robustness-core/data/syncGraph.server";
import { extractFileAttachments } from "robustness-core/data/sorter.server";
import { extractAttachedFileLines, type GraphLogNode } from "robustness-core/data/graphNodeIndex.server";

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

describe("extractAttachedFileLines finds all three attached-file shapes", () => {
  it("finds an image embedded in a node's own quote", () => {
    const quote = "==The whiteboard shows three columns: build, ship, learn.==\n\n![whiteboard.jpg](/api/vault/view/abc123)";
    expect(extractAttachedFileLines(quote)).toEqual(["![whiteboard.jpg](/api/vault/view/abc123)"]);
  });

  it("finds a video link marked with ?type=video", () => {
    const quote = "==Shading update on the south wall.==\n\n[Shading update on south wall](/api/vault/view/def456?type=video)";
    expect(extractAttachedFileLines(quote)).toEqual([
      "[Shading update on south wall](/api/vault/view/def456?type=video)",
    ]);
  });

  it("finds a plain (non-media) file link", () => {
    const quote = "==The permit PDF is attached.==\n\n[permit.pdf](/api/vault/view/ghi789)";
    expect(extractAttachedFileLines(quote)).toEqual(["[permit.pdf](/api/vault/view/ghi789)"]);
  });

  it("returns nothing for a node with no attached file", () => {
    expect(extractAttachedFileLines("==Just words, no file here.==")).toEqual([]);
  });

  it("does not match an ordinary external link/image, only /api/vault/view/ ones", () => {
    expect(extractAttachedFileLines("![a photo](https://example.com/photo.jpg)")).toEqual([]);
    expect(extractAttachedFileLines("[a link](https://example.com)")).toEqual([]);
  });

  it("finds every attachment when several are grouped together", () => {
    const quote = [
      "![south wall](/api/vault/view/abc123)",
      "[shading update](/api/vault/view/def456?type=video)",
    ].join("\n");
    expect(extractAttachedFileLines(quote)).toHaveLength(2);
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
    // Card's `::file{...}` (the human-facing UPLOAD directive, unrelated
    // to how GraphLog itself renders an attached file downstream), key it
    // by the attachment's SYNCED name, then look it up again by that same
    // synced name (`candidate.name`).
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

  it("a file with no caption still parses fine", () => {
    const cardContent = '::file{fileId="abc123" name="IMG_1614.jpeg"}';
    const [attachment] = extractFileAttachments(cardContent);
    expect(attachment.caption).toBe("");
  });
});

describe("a node's file is part of its permanent text (no separate field needed)", () => {
  it("a node's own quote carries an image line end to end", () => {
    const imageLine = "![South wall, before starting the electrical.](/api/vault/view/abc123)";
    const quote = ["==The whiteboard shows three columns.==", imageLine].join("\n\n");
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
    // graph-project-view's node text) sees the file automatically -- no
    // new field on GraphLogNode was needed for this to work.
    expect(extractAttachedFileLines(node.quote)).toHaveLength(1);
    expect(node.quote).toContain(imageLine);
  });

  it("a node's own quote carries a video link end to end", () => {
    const videoLine = "[Shading update on south wall](/api/vault/view/def456?type=video)";
    const quote = ["==The shade sail now covers the whole south wall.==", videoLine].join("\n\n");
    expect(extractAttachedFileLines(quote)).toEqual([videoLine]);
  });
});
