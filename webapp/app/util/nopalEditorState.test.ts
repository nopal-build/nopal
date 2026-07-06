import { describe, it, expect } from "vitest";
import { importFromMarkdown, exportToMarkdown } from "./nopalEditorState";
import { decodeMarkdownEntities } from "./decodeMarkdownEntities";
import type {
  ProseNode,
  TaskGroupNode,
  TaskItemNode,
} from "./nopalEditorState";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return all top-level node types from an EditorState in document order. */
function rootNodeTypes(md: string): string[] {
  const state = importFromMarkdown(md);
  const root = state.nodes.get("root") as { children: string[] };
  return root.children.map((k) => state.nodes.get(k)!.type);
}

/** Return prose nodes' content values in document order. */
function proseContents(md: string): string[] {
  const state = importFromMarkdown(md);
  const root = state.nodes.get("root") as { children: string[] };
  return root.children
    .map((k) => state.nodes.get(k))
    .filter((n) => n?.type === "prose")
    .map((n) => (n as ProseNode).content);
}

// ── decodeMarkdownEntities ────────────────────────────────────────────────────

describe("decodeMarkdownEntities", () => {
  it("decodes hex numeric character references", () => {
    // mdast-util-to-markdown encodes leading spaces as &#x20; to prevent
    // remark from treating them as indented code blocks.
    expect(decodeMarkdownEntities("&#x20;  text")).toBe("   text");
    expect(decodeMarkdownEntities("&#x20;")).toBe(" ");
    expect(decodeMarkdownEntities("&#xA0;")).toBe("\u00a0");
    expect(decodeMarkdownEntities("&#x2014;")).toBe("\u2014"); // em dash
  });

  it("decodes decimal numeric character references", () => {
    expect(decodeMarkdownEntities("&#32;")).toBe(" "); // space
    expect(decodeMarkdownEntities("&#160;")).toBe("\u00a0"); // nbsp
  });

  it("decodes named HTML entities emitted by mdast-util-to-markdown", () => {
    expect(decodeMarkdownEntities("Hello &amp; World")).toBe("Hello & World");
    expect(decodeMarkdownEntities("1. Not &lt;b&gt; bold")).toBe(
      "1. Not <b> bold",
    );
    expect(decodeMarkdownEntities("a &quot;quoted&quot; word")).toBe(
      'a "quoted" word',
    );
    expect(decodeMarkdownEntities("it&apos;s fine")).toBe("it's fine");
    expect(decodeMarkdownEntities("&gt; not a blockquote")).toBe(
      "> not a blockquote",
    );
  });

  it("leaves text without entities unchanged", () => {
    expect(decodeMarkdownEntities("normal text")).toBe("normal text");
    expect(decodeMarkdownEntities("")).toBe("");
    expect(decodeMarkdownEntities("hello & world")).toBe("hello & world");
  });

  it("handles multiple entities in one string", () => {
    expect(decodeMarkdownEntities("&#x20;  hello &amp; world &lt;3")).toBe(
      "   hello & world <3",
    );
  });
});

// ── importFromMarkdown — blank line preservation ──────────────────────────────

describe("importFromMarkdown — blank line preservation", () => {
  it("produces no blank nodes for a single paragraph break (normal Enter)", () => {
    // Two paragraphs separated by exactly one \n\n — no blank ProseNode.
    const types = rootNodeTypes("Hello\n\nWorld");
    expect(types).toEqual(["prose", "prose"]);
  });

  it("preserves one blank line (2 extra Enters = 1 blank node)", () => {
    // Para1 \n\n \n\n Para2 — one empty split segment → one blank ProseNode.
    const types = rootNodeTypes("Para1\n\n\n\nPara2");
    expect(types).toEqual(["prose", "prose", "prose"]);
    const state = importFromMarkdown("Para1\n\n\n\nPara2");
    const root = state.nodes.get("root") as { children: string[] };
    const [, blankKey] = root.children;
    const blank = state.nodes.get(blankKey) as ProseNode;
    expect(blank.content).toBe("");
  });

  it("preserves multiple blank lines (5 Enters = 3 blank nodes)", () => {
    // "Hello" + 8 newlines + "World" splits into 3 empty segments.
    const types = rootNodeTypes("Hello\n\n\n\n\n\n\n\nWorld");
    expect(types).toEqual(["prose", "prose", "prose", "prose", "prose"]);
    // First and last are the content nodes; middle 3 are blanks.
    const state = importFromMarkdown("Hello\n\n\n\n\n\n\n\nWorld");
    const root = state.nodes.get("root") as { children: string[] };
    const blanks = root.children
      .map((k) => state.nodes.get(k) as ProseNode)
      .filter((n) => n.type === "prose" && n.content === "");
    expect(blanks).toHaveLength(3);
  });

  it("preserves blank lines between prose and a task group", () => {
    const types = rootNodeTypes("Some text\n\n\n\n- [ ] task");
    expect(types).toEqual(["prose", "prose", "task-group"]);
  });

  it("treats a whitespace-only paragraph as a blank node", () => {
    // A paragraph that is only whitespace (e.g. ' ') has trim() === '' so
    // importFromMarkdown normalises it to a blank ProseNode with content ''.
    const types = rootNodeTypes("A\n\n \n\nB");
    expect(types).toEqual(["prose", "prose", "prose"]);
    const state = importFromMarkdown("A\n\n \n\nB");
    const root = state.nodes.get("root") as { children: string[] };
    const blank = state.nodes.get(root.children[1]) as ProseNode;
    // Whitespace-only content is normalised to an empty string.
    expect(blank.content).toBe("");
  });

  it("preserves prose content exactly", () => {
    const contents = proseContents("Hello\n\nWorld");
    expect(contents).toEqual(["Hello", "World"]);
  });

  it("flushes an in-progress task group before a blank node", () => {
    // A blank line after tasks should close the task group first so
    // rootChildren order is: [task-group, blank-prose, prose].
    const md = "- [x] Task1\n\n\n\nsome text";
    const types = rootNodeTypes(md);
    expect(types).toEqual(["task-group", "prose", "prose"]);
  });

  it("splits task groups separated by extra blank lines into separate groups", () => {
    // Extra blank lines between task paragraphs end the group — each gets its
    // own TaskGroupNode with a blank ProseNode between them.
    const md = "- [x] Task1\n\n\n\n- [ ] Task2";
    const types = rootNodeTypes(md);
    expect(types).toEqual(["task-group", "prose", "task-group"]);
  });

  it("merges task paragraphs with a single blank line into one group (GFM loose list)", () => {
    // A single \n\n between two task lines — no extra blank — should still
    // merge into one TaskGroupNode with trailingBlank on the first task.
    const md = "- [x] Task1\n\n- [ ] Task2";
    const types = rootNodeTypes(md);
    expect(types).toEqual(["task-group"]);
    const state = importFromMarkdown(md);
    const root = state.nodes.get("root") as { children: string[] };
    const group = state.nodes.get(root.children[0]) as TaskGroupNode;
    expect(group.children).toHaveLength(2);
    const firstTask = state.nodes.get(group.children[0]) as TaskItemNode;
    expect(firstTask.trailingBlank).toBe(true);
  });
});

// ── exportToMarkdown — blank line round-trip ──────────────────────────────────

describe("exportToMarkdown — blank line round-trip", () => {
  it("round-trips a document with no blank lines", () => {
    const md = "Hello\n\nWorld";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips a document with one extra blank line", () => {
    // 4 newlines = 1 empty paragraph in the split
    const md = "Para1\n\n\n\nPara2";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips multiple extra blank lines", () => {
    // 8 newlines = 3 empty paragraphs
    const md = "Hello\n\n\n\n\n\n\n\nWorld";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips blank lines between tasks and prose", () => {
    const md = "- [x] task\n\n\n\nsome text";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips a single task (no blank lines)", () => {
    const md = "- [x] task";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips a GFM loose task list (single blank between tasks)", () => {
    const md = "- [x] Task1\n\n- [ ] Task2";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });

  it("round-trips prose with inline markdown", () => {
    const md =
      "# Heading\n\nSome **bold** and _italic_ text.\n\n> A blockquote";
    expect(exportToMarkdown(importFromMarkdown(md))).toBe(md);
  });
});
