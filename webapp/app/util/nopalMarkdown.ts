/**
 * nopalMarkdown.ts
 *
 * Shared parsing and display utilities for the Nopal markdown format.
 * Used by both MdxEditorClient (live preview) and the daily-log route
 * (past-entry display) so both surfaces render identically.
 *
 * Nopal document format
 * ─────────────────────
 * [user content — paragraphs of prose + optional [nopal-image][N] tokens]
 *
 * # Nopal Markdown
 * Files
 * [1] https://cdn.example.com/photo.jpg
 * [2] Uploading 1 of 2…
 *
 * The file registry is stripped from the rendered output; placement tokens
 * are resolved to real markdown image / link syntax.
 */

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i;
const NOPAL_MARKER = "\n\n# Nopal Markdown\nFiles";
const FILE_LINE_RE = /^\[(\d+)\]\s+(.+)$/;

/**
 * Whether a stored file-registry value is a real, dereferenceable file
 * reference rather than an "uploading..." placeholder. Accepts both
 * legacy absolute URLs (historical documents, uploaded before files were
 * made private) and the current same-origin `/api/vault/view/:fileId`
 * route, which redirects to a freshly-signed S3 URL on every request.
 */
function isFileUrl(value: string): boolean {
  return value.startsWith("http") || value.startsWith("/api/vault/view/");
}
/** Matches a whole paragraph that is purely a placement token (new or legacy format). */
const PLACEMENT_RE = /^\[nopal-image\]\[(\d+)\]$|^\[(\d+)\]$/;

// ── Types ────────────────────────────────────────────────────────────────────

export interface NopalFileEntry {
  index: number;
  url: string | null;
  name: string;
  isImage: boolean;
}

export interface NopalImagePlacement {
  fileIndex: number;
  afterParagraphIndex: number;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parseNopalDocument(raw: string): {
  userContent: string;
  files: NopalFileEntry[];
} {
  const idx = raw.indexOf(NOPAL_MARKER);
  if (idx === -1) return { userContent: raw, files: [] };

  const userContent = raw.slice(0, idx);
  const registrySection = raw.slice(idx + NOPAL_MARKER.length);
  const files: NopalFileEntry[] = [];

  for (const line of registrySection.split("\n")) {
    const m = line.match(FILE_LINE_RE);
    if (!m) continue;
    const index = parseInt(m[1]);
    const value = m[2].trim();
    const isUrl = isFileUrl(value);
    files.push({
      index,
      url: isUrl ? value : null,
      name: value,
      isImage: isUrl ? IMAGE_EXT.test(value) : false,
    });
  }

  return { userContent, files };
}

export function parseNopalUserContent(content: string): {
  editorText: string;
  placements: NopalImagePlacement[];
} {
  const paras = content.split("\n\n");
  const clean: string[] = [];
  const placements: NopalImagePlacement[] = [];

  for (const para of paras) {
    const m = para.trim().match(PLACEMENT_RE);
    if (m) {
      placements.push({
        fileIndex: parseInt(m[1] ?? m[2]),
        afterParagraphIndex: clean.length,
      });
    } else {
      clean.push(para);
    }
  }

  return { editorText: clean.join("\n\n"), placements };
}

// ── Serialisation helpers (used by workable + editable modes) ───────────────

/**
 * Rebuilds the user-content section from clean editorText + placements.
 * Placement tokens (`[nopal-image][N]`) are re-inserted at the recorded
 * paragraph boundaries so the stored markdown can be round-tripped.
 */
export function buildUserContent(
  editorText: string,
  placements: NopalImagePlacement[],
): string {
  const allParas = editorText.split("\n\n");
  let hi = allParas.length - 1;
  while (hi >= 0 && allParas[hi].trim() === "") hi--;
  const paras = hi >= 0 ? allParas.slice(0, hi + 1) : [];
  const result = [...paras];

  const sorted = [...placements].sort(
    (a, b) => b.afterParagraphIndex - a.afterParagraphIndex,
  );
  for (const { fileIndex, afterParagraphIndex } of sorted) {
    result.splice(
      Math.min(afterParagraphIndex, result.length),
      0,
      `[nopal-image][${fileIndex}]`,
    );
  }
  return result.join("\n\n");
}

/**
 * Serialises userContent + file registry back into the full stored nopal
 * markdown format. Accepts any object with `index`, `url`, and `name` so
 * both FileEntry (editable) and NopalFileEntry (view/workable) work.
 */
export function serializeDocument(
  userContent: string,
  files: Array<{ index: number; url: string | null; name: string }>,
): string {
  if (files.length === 0) return userContent;
  const lines = files.map((f) => `[${f.index}] ${f.url ?? f.name}`);
  return `${userContent.trimEnd()}${NOPAL_MARKER}\n${lines.join("\n")}`;
}

// ── Task-mutation utilities (used by workable mode) ──────────────────────────

const TASK_LINE_RE = /^(\s*[-*]\s+)\[([xX ])\]\s+(.*)/;

/** Returns metadata for every task line found in the markdown. */
function getTaskLinesMeta(text: string): Array<{
  lineIndex: number;
  checked: boolean;
  text: string;
  prefix: string;
}> {
  const lines = text.split("\n");
  const tasks: Array<{
    lineIndex: number;
    checked: boolean;
    text: string;
    prefix: string;
  }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_LINE_RE);
    if (!m) continue;
    tasks.push({
      lineIndex: i,
      checked: m[2].toLowerCase() === "x",
      text: m[3],
      prefix: m[1],
    });
  }
  return tasks;
}

/** Groups of consecutive task lines (one group = one checklist block). */
export interface TaskGroup {
  startTaskIndex: number;
  count: number;
}

export function getTaskGroups(editorText: string): TaskGroup[] {
  const lines = editorText.split("\n");
  const groups: TaskGroup[] = [];
  let inTask = false;
  let groupStart = 0;
  let globalTaskIdx = 0;
  let groupCount = 0;

  for (const line of lines) {
    const isTask = TASK_LINE_RE.test(line);
    const isBlank = line.trim() === "";
    if (isTask) {
      if (!inTask) {
        inTask = true;
        groupStart = globalTaskIdx;
        groupCount = 0;
      }
      groupCount++;
      globalTaskIdx++;
    } else if (inTask && !isBlank) {
      // Only a non-blank, non-task line ends the group.
      // Blank lines within a GFM loose list don't break the checklist boundary.
      inTask = false;
      groups.push({ startTaskIndex: groupStart, count: groupCount });
    }
  }
  if (inTask) groups.push({ startTaskIndex: groupStart, count: groupCount });
  return groups;
}

/** Toggle a task checkbox by global task index. */
export function toggleTask(
  markdown: string,
  taskIndex: number,
  checked: boolean,
): string {
  const lines = markdown.split("\n");
  const tasks = getTaskLinesMeta(markdown);
  const task = tasks[taskIndex];
  if (!task) return markdown;
  lines[task.lineIndex] = `${task.prefix}[${checked ? "x" : " "}] ${task.text}`;
  return lines.join("\n");
}

/** Replace the text of a task item by global task index. */
export function editTaskText(
  markdown: string,
  taskIndex: number,
  newText: string,
): string {
  const lines = markdown.split("\n");
  const tasks = getTaskLinesMeta(markdown);
  const task = tasks[taskIndex];
  if (!task) return markdown;
  const mark = task.checked ? "x" : " ";
  lines[task.lineIndex] = `${task.prefix}[${mark}] ${newText}`;
  return lines.join("\n");
}

/** Remove a task item by global task index. */
export function removeTask(markdown: string, taskIndex: number): string {
  const lines = markdown.split("\n");
  const tasks = getTaskLinesMeta(markdown);
  const task = tasks[taskIndex];
  if (!task) return markdown;
  lines.splice(task.lineIndex, 1);
  return lines.join("\n");
}

/**
 * Insert a new empty task (`- [ ] `) immediately after the task at
 * `afterTaskIndex`. If `afterTaskIndex` is -1, appends to the document.
 */
export function addTaskAfterTask(
  markdown: string,
  afterTaskIndex: number,
  newText = "",
): string {
  const lines = markdown.split("\n");
  const tasks = getTaskLinesMeta(markdown);
  const task = tasks[afterTaskIndex];
  const insertAt = task ? task.lineIndex + 1 : lines.length;
  const prefix = task ? task.prefix : "- ";
  lines.splice(insertAt, 0, `${prefix}[ ] ${newText}`);
  return lines.join("\n");
}

// ── Display rendering ─────────────────────────────────────────────────────────

/**
 * Builds a display-ready markdown string from pre-parsed editor state.
 * Placement tokens are replaced with real `![name](url)` or `[name](url)` refs.
 * Used directly by MdxEditorClient which already has live parsed state.
 */
export function buildDisplayMarkdown(
  editorText: string,
  placements: NopalImagePlacement[],
  files: NopalFileEntry[],
): string {
  const paras = editorText.split("\n\n").filter((p) => p.trim() !== "");
  const result = [...paras];

  // Insert from the end so earlier indices don't shift
  const sorted = [...placements].sort(
    (a, b) => b.afterParagraphIndex - a.afterParagraphIndex,
  );
  for (const { fileIndex, afterParagraphIndex } of sorted) {
    const file = files.find((f) => f.index === fileIndex);
    if (!file?.url) continue;
    const mdRef = file.isImage
      ? `![${file.name}](${file.url})`
      : `[${file.name}](${file.url})`;
    result.splice(Math.min(afterParagraphIndex, result.length), 0, mdRef);
  }

  return result.join("\n\n");
}

/**
 * Fully resolves a raw stored Nopal markdown string into display-ready markdown:
 * strips the `# Nopal Markdown` registry section and replaces all
 * `[nopal-image][N]` placement tokens with real image / file link syntax.
 *
 * Use this wherever you display saved content without an interactive editor
 * (e.g. past log entries, read-only views).
 */
export function resolveNopalMarkdown(raw: string): string {
  const { userContent, files } = parseNopalDocument(raw);
  const { editorText, placements } = parseNopalUserContent(userContent);
  return buildDisplayMarkdown(editorText, placements, files);
}
