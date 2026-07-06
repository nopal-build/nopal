/**
 * nopalEditorState.ts
 *
 * Lexical-inspired flat node map state management for the nopal Workable and
 * View editor modes.
 *
 * Architecture mirrors Lexical's core:
 *   EditorState    ↔  Lexical EditorState
 *   NodeKey        ↔  Lexical NodeKey
 *   nodes Map      ↔  Lexical _nodeMap  (flat, O(1) lookup)
 *   EditorCommand  ↔  Lexical LexicalCommand<P>
 *   editorReducer  ↔  Lexical editor.update() + registerCommand handlers
 *   importFromMarkdown  ↔  $convertFromMarkdownString / importJSON
 *   exportToMarkdown    ↔  $convertToMarkdownString / exportJSON
 *
 * React integration:
 *   Workable:  const [state, dispatch] = useReducer(editorReducer, rawMd, importFromMarkdown)
 *   View:      const state = useMemo(() => importFromMarkdown(rawMd), [rawMd])
 */

import type { NopalFileEntry } from "./nopalMarkdown";
import { parseNopalDocument, serializeDocument } from "./nopalMarkdown";

// ── Node key ──────────────────────────────────────────────────────────────────

/** Stable UUID string assigned once on import.  Mirrors Lexical's NodeKey. */
export type NodeKey = string;

function uuid(): NodeKey {
  return crypto.randomUUID();
}

// ── Node types ────────────────────────────────────────────────────────────────

/**
 * Root node — document-level sentinel holding ordered top-level block keys.
 * Mirrors Lexical's RootNode.  Always stored under the fixed key `"root"`.
 */
export interface RootNode {
  type: "root";
  key: "root";
  children: NodeKey[];
}

/**
 * Prose node — a raw markdown block with no task lines and no placement tokens.
 * Rendered by <ReactMarkdown>.
 */
export interface ProseNode {
  type: "prose";
  key: NodeKey;
  content: string;
}

/**
 * Task-group node — one checklist block.  Mirrors Lexical's ListNode.
 * `children` are TaskItemNode keys in document order.
 */
export interface TaskGroupNode {
  type: "task-group";
  key: NodeKey;
  children: NodeKey[];
}

/**
 * Task-item node — a single checkbox item.  Mirrors Lexical's ListItemNode.
 * `parent` is the owning TaskGroupNode key (mirrors Lexical's __parent).
 *
 * `prefix`       — original bullet marker ("- ", "* ", "  - " …, or "" for bare `[ ]` style).
 *                  Preserved so serialisation round-trips cleanly.
 * `trailingBlank` — true when a blank line followed this item in the source,
 *                  producing a GFM loose-list entry.  Preserved on save.
 */
export interface TaskItemNode {
  type: "task-item";
  key: NodeKey;
  parent: NodeKey;
  text: string;
  checked: boolean;
  prefix: string;
  trailingBlank: boolean;
}

/**
 * Image-placement node — a [nopal-image][N] token baked into the block tree
 * so document layout is fully captured in EditorState (no separate placements
 * array needed at render time).
 */
export interface ImagePlacementNode {
  type: "image-placement";
  key: NodeKey;
  fileIndex: number;
}

export type EditorNode =
  | RootNode
  | ProseNode
  | TaskGroupNode
  | TaskItemNode
  | ImagePlacementNode;

/**
 * EditorState — an immutable snapshot of the document.
 * Mirrors Lexical's EditorState.
 *
 *   nodes  — flat key→node registry (Lexical's _nodeMap).  O(1) lookup.
 *   files  — nopal file registry (from the "# Nopal Markdown" section).
 */
export interface EditorState {
  nodes: ReadonlyMap<NodeKey, EditorNode>;
  files: ReadonlyArray<NopalFileEntry>;
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Typed command union.  Mirrors Lexical's LexicalCommand<P> + dispatchCommand.
 * Handled by editorReducer — our editor.update() + registerCommand equivalent.
 */
export type EditorCommand =
  | {
      type: "TOGGLE_TASK";
      groupKey: NodeKey;
      taskKey: NodeKey;
      checked: boolean;
    }
  | {
      type: "EDIT_TASK_TEXT";
      groupKey: NodeKey;
      taskKey: NodeKey;
      text: string;
    }
  | { type: "REMOVE_TASK"; groupKey: NodeKey; taskKey: NodeKey }
  | {
      type: "ADD_TASK";
      groupKey: NodeKey;
      afterKey: NodeKey | null;
      text?: string;
    }
  | { type: "ADD_FILE"; file: NopalFileEntry }
  | { type: "REMOVE_FILE"; fileIndex: number }
  | { type: "IMPORT"; markdown: string };

// ── Parsing (importFromMarkdown) ──────────────────────────────────────────────

// Matches both `- [ ] text` (GFM / Obsidian) and bare `[ ] text` (GitHub-wiki style).
// The bullet prefix group (`- `, `* `, …) is optional and defaults to "" when absent.
const TASK_LINE_RE = /^(\s*(?:[-*]\s+)?)\[([xX ])\]\s+(.*)/;
/** Matches a whole \n\n-paragraph that is purely a placement token. */
const PLACEMENT_PARA_RE = /^\[nopal-image\]\[(\d+)\]$|^\[(\d+)\]$/;

/**
 * Parse a raw nopal markdown string into an EditorState.
 * Mirrors Lexical's $convertFromMarkdownString / importJSON.
 *
 * Block-detection rules (applied per \n\n-paragraph):
 *   · Paragraph whose non-empty lines all match TASK_LINE_RE → TaskGroupNode.
 *   · Consecutive task paragraphs (separated only by \n\n) collapse into one
 *     TaskGroupNode (GFM loose-list).  The blank line is encoded as
 *     `trailingBlank: true` on the last TaskItemNode of each intermediate para.
 *   · Paragraph matching PLACEMENT_PARA_RE → ImagePlacementNode.
 *   · Everything else → ProseNode.
 *
 * All created nodes receive fresh UUIDs, stable for the editor session.
 */
export function importFromMarkdown(rawMarkdown: string): EditorState {
  const { userContent, files } = parseNopalDocument(rawMarkdown);

  const nodes = new Map<NodeKey, EditorNode>();
  const rootChildren: NodeKey[] = [];
  const root: RootNode = { type: "root", key: "root", children: rootChildren };
  nodes.set("root", root);

  // ── Running group accumulator ──────────────────────────────────────────────
  let groupKey: NodeKey | null = null;
  let groupChildren: NodeKey[] = [];
  let lastTaskKey: NodeKey | null = null; // used to stamp trailingBlank
  let prevWasTask = false;

  const flushGroup = () => {
    if (groupKey && groupChildren.length > 0) {
      nodes.set(groupKey, {
        type: "task-group",
        key: groupKey,
        children: groupChildren,
      } as TaskGroupNode);
      rootChildren.push(groupKey);
    }
    groupKey = null;
    groupChildren = [];
    lastTaskKey = null;
  };

  for (const para of userContent.split("\n\n")) {
    const trimmed = para.trim();
    if (!trimmed) {
      // Preserve the blank line as an empty prose node so View/Workable mode
      // shows the same spacing the user created in the editable mode.  Extra
      // consecutive \n\n separators each produce one empty ProseNode; they
      // all render as a single blank line height in MdxRenderer.
      flushGroup();
      prevWasTask = false;
      const key = uuid();
      nodes.set(key, { type: "prose", key, content: "" } as ProseNode);
      rootChildren.push(key);
      continue;
    }

    // ── Image placement token ──────────────────────────────────────────────
    const pm = trimmed.match(PLACEMENT_PARA_RE);
    if (pm) {
      flushGroup();
      prevWasTask = false;
      const fileIndex = parseInt(pm[1] ?? pm[2], 10);
      const key = uuid();
      nodes.set(key, {
        type: "image-placement",
        key,
        fileIndex,
      } as ImagePlacementNode);
      rootChildren.push(key);
      continue;
    }

    // ── Decide: task paragraph or prose? ──────────────────────────────────
    const lines = para.split("\n");
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    const isTaskPara =
      nonEmpty.length > 0 && nonEmpty.every((l) => TASK_LINE_RE.test(l));

    if (isTaskPara) {
      // Mark the last task of the in-progress group as having a trailing blank
      // line — we know this because the \n\n separator just happened.
      if (prevWasTask && lastTaskKey) {
        const prev = nodes.get(lastTaskKey) as TaskItemNode;
        nodes.set(lastTaskKey, { ...prev, trailingBlank: true });
      }

      // Start a new group only if we aren't continuing one from the prev para.
      if (!groupKey) {
        groupKey = uuid();
        groupChildren = [];
      }

      for (const line of lines) {
        const m = line.match(TASK_LINE_RE);
        if (!m) continue;
        const taskKey = uuid();
        const task: TaskItemNode = {
          type: "task-item",
          key: taskKey,
          parent: groupKey,
          text: m[3],
          checked: m[2].toLowerCase() === "x",
          prefix: m[1],
          trailingBlank: false,
        };
        nodes.set(taskKey, task);
        groupChildren.push(taskKey);
        lastTaskKey = taskKey;
      }
      prevWasTask = true;
    } else {
      // ── Prose paragraph ──────────────────────────────────────────────────
      flushGroup();
      prevWasTask = false;
      const key = uuid();
      nodes.set(key, { type: "prose", key, content: para } as ProseNode);
      rootChildren.push(key);
    }
  }

  flushGroup();

  return { nodes, files };
}

// ── Serialisation (exportToMarkdown) ─────────────────────────────────────────

/**
 * Serialise an EditorState back to a raw nopal markdown string.
 * Mirrors Lexical's $convertToMarkdownString / exportJSON.
 */
export function exportToMarkdown(state: EditorState): string {
  const root = state.nodes.get("root") as RootNode | undefined;
  if (!root) return "";

  const parts: string[] = [];

  for (const childKey of root.children) {
    const node = state.nodes.get(childKey);
    if (!node) continue;

    switch (node.type) {
      case "prose": {
        parts.push(node.content);
        break;
      }
      case "task-group": {
        const lines: string[] = [];
        for (const taskKey of node.children) {
          const task = state.nodes.get(taskKey) as TaskItemNode | undefined;
          if (!task) continue;
          lines.push(
            `${task.prefix}[${task.checked ? "x" : " "}] ${task.text}`,
          );
          if (task.trailingBlank) lines.push(""); // restore GFM loose-list blank
        }
        // Drop any trailing blank line left by the last task item
        while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        parts.push(lines.join("\n"));
        break;
      }
      case "image-placement": {
        parts.push(`[nopal-image][${node.fileIndex}]`);
        break;
      }
      // 'root', 'task-item' are never top-level children — skip
    }
  }

  const userContent = parts.join("\n\n");
  return serializeDocument(userContent, state.files as NopalFileEntry[]);
}

// ── Reducer helpers ───────────────────────────────────────────────────────────
// Mirrors Lexical's internal $getNodeByKey / $setNodeState helpers.
// All return a new EditorState — never mutate in place.

function setNode(state: EditorState, node: EditorNode): EditorState {
  const nodes = new Map(state.nodes);
  nodes.set(node.key, node);
  return { ...state, nodes };
}

function setNodes(state: EditorState, updates: EditorNode[]): EditorState {
  const nodes = new Map(state.nodes);
  for (const n of updates) nodes.set(n.key, n);
  return { ...state, nodes };
}

function dropNode(state: EditorState, key: NodeKey): EditorState {
  const nodes = new Map(state.nodes);
  nodes.delete(key);
  return { ...state, nodes };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

/**
 * Pure state reducer.  Mirrors Lexical's editor.update() + registerCommand.
 *
 * Usage:
 *   const [state, dispatch] = useReducer(editorReducer, rawMarkdown, importFromMarkdown)
 */
export function editorReducer(
  state: EditorState,
  cmd: EditorCommand,
): EditorState {
  switch (cmd.type) {
    // ── Task mutations ───────────────────────────────────────────────────────

    case "TOGGLE_TASK": {
      const task = state.nodes.get(cmd.taskKey) as TaskItemNode | undefined;
      if (task?.type !== "task-item") return state;
      return setNode(state, { ...task, checked: cmd.checked });
    }

    case "EDIT_TASK_TEXT": {
      const task = state.nodes.get(cmd.taskKey) as TaskItemNode | undefined;
      if (task?.type !== "task-item") return state;
      return setNode(state, { ...task, text: cmd.text });
    }

    case "REMOVE_TASK": {
      const group = state.nodes.get(cmd.groupKey) as TaskGroupNode | undefined;
      if (group?.type !== "task-group") return state;
      const newChildren = group.children.filter((k) => k !== cmd.taskKey);
      const newGroup: TaskGroupNode = { ...group, children: newChildren };

      if (newChildren.length === 0) {
        // Empty group — also remove it from the root
        const root = state.nodes.get("root") as RootNode;
        const newRoot: RootNode = {
          ...root,
          children: root.children.filter((k) => k !== cmd.groupKey),
        };
        return setNodes(dropNode(state, cmd.taskKey), [newGroup, newRoot]);
      }
      return setNodes(dropNode(state, cmd.taskKey), [newGroup]);
    }

    case "ADD_TASK": {
      const group = state.nodes.get(cmd.groupKey) as TaskGroupNode | undefined;
      if (group?.type !== "task-group") return state;

      // Inherit the prefix from the last item in the group for consistency
      const lastKey = group.children[group.children.length - 1];
      const lastTask = state.nodes.get(lastKey) as TaskItemNode | undefined;
      const prefix = lastTask?.prefix ?? "- ";

      const newTask: TaskItemNode = {
        type: "task-item",
        key: uuid(),
        parent: cmd.groupKey,
        text: cmd.text ?? "",
        checked: false,
        prefix,
        trailingBlank: false,
      };

      const insertIdx =
        cmd.afterKey !== null
          ? group.children.indexOf(cmd.afterKey) + 1
          : group.children.length;

      const newChildren = [...group.children];
      newChildren.splice(insertIdx, 0, newTask.key);
      const newGroup: TaskGroupNode = { ...group, children: newChildren };
      return setNodes(state, [newTask, newGroup]);
    }

    // ── File mutations ───────────────────────────────────────────────────────

    case "ADD_FILE": {
      return { ...state, files: [...state.files, cmd.file] };
    }

    case "REMOVE_FILE": {
      const files = state.files.filter((f) => f.index !== cmd.fileIndex);

      // Remove any ImagePlacementNodes pointing at this file index
      const root = state.nodes.get("root") as RootNode | undefined;
      if (!root) return { ...state, files };

      const toRemove = root.children.filter((k) => {
        const n = state.nodes.get(k);
        return (
          n?.type === "image-placement" &&
          (n as ImagePlacementNode).fileIndex === cmd.fileIndex
        );
      });

      if (toRemove.length === 0) return { ...state, files };

      const newRoot: RootNode = {
        ...root,
        children: root.children.filter((k) => !toRemove.includes(k)),
      };
      let next: EditorState = { ...state, files };
      for (const k of toRemove) next = dropNode(next, k);
      return setNode(next, newRoot);
    }

    // ── Full reload ──────────────────────────────────────────────────────────

    case "IMPORT":
      return importFromMarkdown(cmd.markdown);

    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────
// Read-only helpers for components.  Mirrors Lexical's $getNodeByKey and
// typed accessor conventions.

/** Get a typed node by key. Returns undefined if not found or wrong type. */
export function getNode<T extends EditorNode>(
  state: EditorState,
  key: NodeKey,
  type: T["type"],
): T | undefined {
  const node = state.nodes.get(key);
  return node?.type === type ? (node as T) : undefined;
}

/** Returns TaskItemNodes for a group in document order. */
export function getTaskItems(
  state: EditorState,
  group: TaskGroupNode,
): TaskItemNode[] {
  return group.children
    .map((k) => state.nodes.get(k))
    .filter((n): n is TaskItemNode => n?.type === "task-item");
}

/**
 * Returns the set of file indices that have an ImagePlacementNode in the tree.
 * Used by ReferencesSection to determine which files are "placed" vs unplaced.
 */
export function getPlacedFileIndices(state: EditorState): Set<number> {
  const root = state.nodes.get("root") as RootNode | undefined;
  if (!root) return new Set();
  const placed = new Set<number>();
  for (const key of root.children) {
    const node = state.nodes.get(key);
    if (node?.type === "image-placement") placed.add(node.fileIndex);
  }
  return placed;
}
