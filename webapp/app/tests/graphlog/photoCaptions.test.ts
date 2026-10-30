/**
 * A caption on a photo already on the project (`caption-an-uploaded-photo`,
 * 2026-10-29). Written on the Photos tab as a file mark with no act, it
 * reaches sync-graph through the marks file like any mark; what this round
 * adds is that the node quoting it carries the photo, so a brief can cite
 * it. The node stays the writer's highlighted words (ADR-012): the photo
 * is attached beside them, never treated as the node's source file, which
 * would make it description-only.
 */

import { describe, expect, it } from "vitest";
import { buildMarksFileContent, parseMarkTexts, type GraphLogMark, type MarkUnitSnapshot } from "robustness-core/data/graphLogMarks.server";
import { createSyncGraphExecutors, markedFileFor, markedFilesOf, marksNotCaptured, type MarkedFile } from "robustness-core/data/syncGraph.server";

const photoUnit = (attachmentId: string, name: string): MarkUnitSnapshot => ({
  key: `file:${attachmentId}`,
  kind: "file",
  section: "",
  effort: "",
  text: name,
  refs: [{ name: "Seed", humanId: null, date: "2026-09-30", fileId: attachmentId }],
  attachmentId,
});

type Mark = Pick<GraphLogMark, "date" | "author_human_id" | "text" | "unit" | "act">;
const mark = (over: Partial<Mark> & Pick<Mark, "text">): Mark => ({
  date: "2026-10-29",
  author_human_id: "austin",
  unit: photoUnit("seed1", "attic-hatch.jpg"),
  act: null,
  ...over,
});

const rows = new Map([
  // A sown photo is served by itself; a Card attachment by its synced copy.
  ["seed1", { serveId: "seed1", name: "attic-hatch.jpg", contentType: "image/jpeg" }],
  ["orig2", { serveId: "copy2", name: "eaves.jpg", contentType: "image/jpeg" }],
]);

describe("which photo a person's words were written on", () => {
  const marks: Mark[] = [
    mark({ text: "This is the removable cover; the gap is behind the shakes." }),
    mark({ text: "Baffles go in before the blown-in.", unit: photoUnit("orig2", "eaves.jpg") }),
    // Lucas on the same photo, the same day: his own caption, his own file.
    mark({ author_human_id: "lucas", text: "Cover screws are stripped." }),
    // An act is a tap, not a caption.
    mark({ text: "Filed as photo.", act: { kind: "file-as", fileKind: "photo" } }),
    // Yesterday's is yesterday's.
    mark({ date: "2026-10-28", text: "Older words." }),
    // A page mark is not on a file.
    mark({ text: "On the page.", unit: { ...photoUnit("x", "x"), kind: "sentence", attachmentId: null } }),
  ];

  it("is one person's own words on files, that day, each served the way the Photos tab serves it", () => {
    const austin = markedFilesOf(marks, rows, "2026-10-29", "austin");
    expect(austin.map((m) => [m.text, m.file.fileId])).toEqual([
      ["This is the removable cover; the gap is behind the shakes.", "seed1"],
      ["Baffles go in before the blown-in.", "copy2"],
    ]);
    expect(austin[0].file).toMatchObject({ name: "attic-hatch.jpg", contentType: "image/jpeg", caption: "This is the removable cover; the gap is behind the shakes." });
  });

  it("keeps two people's captions on one photo apart: two writers, two marks files, two nodes", () => {
    expect(markedFilesOf(marks, rows, "2026-10-29", "lucas").map((m) => m.text)).toEqual(["Cover screws are stripped."]);
  });

  it("finds the photo by the words a node quotes, and nothing for words from elsewhere", () => {
    const marked = markedFilesOf(marks, rows, "2026-10-29", "austin");
    expect(markedFileFor([{ type: "paragraph", text: "the gap is behind the shakes." }], marked)?.fileId).toBe("seed1");
    expect(markedFileFor([{ type: "list", items: ["Baffles go in before the blown-in."] }], marked)?.fileId).toBe("copy2");
    expect(markedFileFor([{ type: "paragraph", text: "Something the page said." }], marked)).toBeNull();
    expect(markedFileFor([{ type: "paragraph", text: "anything" }], [])).toBeNull();
  });
});

describe("the node a caption becomes", () => {
  const caption = "This is the removable cover; the gap is behind the shakes.";
  const marksFile = buildMarksFileContent([{ text: caption, unit: photoUnit("seed1", "attic-hatch.jpg") }]);
  const markTexts = parseMarkTexts(marksFile);
  const marked: MarkedFile[] = markedFilesOf([mark({ text: caption })], rows, "2026-10-29", "austin");
  const executorsFor = () =>
    createSyncGraphExecutors({
      date: "2026-10-29",
      sourceCitations: [':ref{name="Austin" humanId="austin" datetime="2026-10-29T12:00:00Z" location="/vault?file=marks1" verbose}'],
      sourceFiles: [null],
      sourceMarkTexts: [markTexts],
      sourceMarkFiles: [marked],
      sourceSeed: [null],
      knownBackwardIds: new Map(),
    });

  it("is the writer's highlighted words with the photo under them, and no description-only line", async () => {
    const { executors, getNodeBlocks } = executorsFor();
    const result = await executors.add_node({ sourceIndex: 0, blocks: [{ type: "paragraph", text: caption }] });
    expect(result).not.toMatch(/^Error/);
    const [node] = getNodeBlocks();
    expect(node).toContain(`==${caption}==`);
    expect(node).toContain(`![${caption}](/api/vault/view/seed1)`);
    expect(node).not.toContain("AI description");
    expect(node).toContain('location="/vault?file=marks1"');
  });

  it("carries the photo too when the model passed the caption over and code writes it verbatim", () => {
    const { appendVerbatimNode, getNodeBlocks } = executorsFor();
    const missed = marksNotCaptured([markTexts], getNodeBlocks());
    expect(missed).toHaveLength(1);
    for (const m of missed) appendVerbatimNode(m);
    const [node] = getNodeBlocks();
    expect(node).toContain(`==${caption}==`);
    expect(node).toContain("(/api/vault/view/seed1)");
  });

  it("leaves a node from a Card, or from words on no photo, exactly as before", async () => {
    const { executors, getNodeBlocks } = createSyncGraphExecutors({
      date: "2026-10-29",
      sourceCitations: [":ref{}"],
      sourceFiles: [null],
      sourceMarkTexts: [null],
      sourceSeed: [null],
      knownBackwardIds: new Map(),
    });
    await executors.add_node({ sourceIndex: 0, blocks: [{ type: "paragraph", text: "Sealed the top plates." }] });
    expect(getNodeBlocks()[0]).not.toContain("/api/vault/view/");
  });
});
