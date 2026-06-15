/**
 * MdxRenderer.tsx
 *
 * Shared react-markdown based renderer used by:
 *   - MdxEditorView    (static, read-only)
 *   - MdxEditorWorkable (task-interactive, inline CSV editing)
 *
 * No CodeMirror / heavy syntax highlighting — code blocks are plain <pre><code>.
 * Visual appearance matches the MDX editor (.nopal-content CSS class).
 *
 * Mode detection: when `onChange` is present → workable mode.
 */

import "../styles/mdxeditor.css";

import type {
  NopalFileEntry,
  NopalImagePlacement,
} from "../util/nopalMarkdown";
import {
  getTaskGroups,
  toggleTask,
  editTaskText,
  removeTask,
  addTaskAfterTask,
} from "../util/nopalMarkdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useState, useRef, useMemo, useCallback } from "react";

// ── Public props interface ─────────────────────────────────────────────────────

export interface MdxRendererProps {
  /** Clean markdown (no nopal placement tokens) */
  editorText: string;
  /** File entries from nopalMarkdown.ts */
  files: NopalFileEntry[];
  /** Image placements from nopalMarkdown.ts */
  placements: NopalImagePlacement[];
  /** Present → workable mode; absent → view mode */
  onChange?: (newEditorText: string) => void;
  /** key→value map for CSV ref chips */
  csvFields?: Record<string, string>;
  /** Called when a CSV chip value is edited inline (workable only) */
  onCsvFieldChange?: (key: string, value: string) => void;
  /** Show × Remove / + Add file controls */
  canManageFiles?: boolean;
  onAddFile?: () => void;
  onRemoveFile?: (fileIndex: number) => void;
  /** Extra class names merged onto the root .nopal-content div */
  className?: string;
}

// ── Internal types ────────────────────────────────────────────────────────────

type Segment =
  | { type: "markdown"; text: string }
  | { type: "images"; fileIndices: number[] };

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Splits the clean editorText into alternating markdown/image segments by
 * resolving afterParagraphIndex placements against the paragraph array.
 *
 * afterParagraphIndex=N means "insert before paras[N]", so:
 *   N=0 → images first, then all text
 *   N=1 → paras[0], images, paras[1…]
 *   N=len → all text, then images
 */
function buildSegments(
  editorText: string,
  placements: NopalImagePlacement[],
): Segment[] {
  // Split and trim trailing empty paragraphs
  const allParas = editorText.split("\n\n");
  let hi = allParas.length - 1;
  while (hi >= 0 && allParas[hi].trim() === "") hi--;
  const paras = hi >= 0 ? allParas.slice(0, hi + 1) : [];

  if (placements.length === 0) {
    const text = paras.join("\n\n");
    return text ? [{ type: "markdown", text }] : [];
  }

  // Group file indices by afterParagraphIndex
  const groups = new Map<number, number[]>();
  for (const { fileIndex, afterParagraphIndex } of placements) {
    const arr = groups.get(afterParagraphIndex) ?? [];
    arr.push(fileIndex);
    groups.set(afterParagraphIndex, arr);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let prev = 0;

  for (const idx of sortedKeys) {
    const text = paras.slice(prev, idx).join("\n\n");
    if (text.trim()) segments.push({ type: "markdown", text });
    segments.push({ type: "images", fileIndices: groups.get(idx)! });
    prev = idx;
  }

  const remaining = paras.slice(prev).join("\n\n");
  if (remaining.trim()) segments.push({ type: "markdown", text: remaining });

  return segments;
}

/**
 * Replace known `[key]` patterns with an HTML span placeholder that rehype-raw
 * will keep as-is.  Our custom `span` renderer converts them to CsvChip nodes.
 */
function preprocessCsvRefs(
  text: string,
  csvFields: Record<string, string>,
): string {
  return text.replace(/\[([^\[\]\n]+)\]/g, (match, key) => {
    if (key in csvFields)
      return `<span class="nopal-csv-placeholder" data-csv-key="${encodeURIComponent(key)}"></span>`;
    return match;
  });
}

/** Extract the raw text of task #taskIndex from the editorText. */
const TASK_TEXT_RE = /^\s*[-*]\s+\[([xX ])\]\s+(.*)/;

function getTaskText(editorText: string, taskIndex: number): string {
  let count = 0;
  for (const line of editorText.split("\n")) {
    const m = line.match(TASK_TEXT_RE);
    if (!m) continue;
    if (count === taskIndex) return m[2];
    count++;
  }
  return "";
}

// ── CsvChip ───────────────────────────────────────────────────────────────────
// Standalone component — does NOT depend on Lexical or the MDX editor context.

interface CsvChipProps {
  csvKey: string;
  value: string;
  editable: boolean;
  onChange?: (key: string, value: string) => void;
}

function CsvChip({ csvKey, value, editable, onChange }: CsvChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const empty = !value || value.trim() === "";

  const startEdit = () => {
    if (!editable || !onChange) return;
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange?.(csvKey, draft);
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="csv-ref-input"
        value={draft}
        size={Math.max(draft.length, csvKey.length, 4)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`csv-ref-chip${empty ? " csv-ref-chip--empty" : ""}`}
      style={
        !editable ? { pointerEvents: "none", cursor: "default" } : undefined
      }
      title={editable ? `${csvKey} — click to edit` : csvKey}
      onClick={startEdit}
    >
      {empty ? csvKey : value}
    </button>
  );
}

// ── ImageBlock ─────────────────────────────────────────────────────────────────

interface ImageBlockProps {
  fileIndices: number[];
  files: NopalFileEntry[];
}

function ImageBlock({ fileIndices, files }: ImageBlockProps) {
  const images = fileIndices
    .map((idx) => files.find((f) => f.index === idx))
    .filter((f): f is NopalFileEntry => !!f && f.isImage && !!f.url);

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div className="nopal-image-block nopal-image-block--single">
        <img src={images[0].url!} alt={images[0].name} />
      </div>
    );
  }

  return (
    <div className="nopal-image-block nopal-image-block--masonry">
      {images.map((img) => (
        <div key={img.index} className="nopal-image-block-item">
          <img src={img.url!} alt={img.name} />
        </div>
      ))}
    </div>
  );
}

// ── ReferencesSection ─────────────────────────────────────────────────────────

interface ReferencesSectionProps {
  files: NopalFileEntry[];
  placements: NopalImagePlacement[];
  canManageFiles?: boolean;
  onAddFile?: () => void;
  onRemoveFile?: (fileIndex: number) => void;
}

function ReferencesSection({
  files,
  placements,
  canManageFiles,
  onAddFile,
  onRemoveFile,
}: ReferencesSectionProps) {
  const placedSet = new Set(placements.map((p) => p.fileIndex));
  const unplaced = files.filter((f) => !placedSet.has(f.index));
  const images = unplaced.filter((f) => f.isImage && !!f.url);
  const others = unplaced.filter((f) => !f.isImage || !f.url);

  if (unplaced.length === 0 && !canManageFiles) return null;

  return (
    <section className="nopal-references">
      {/* Uses standalone .nopal-references-heading class, not .nopal-content h2/h3,
          to avoid inherited heading margin-top from the nested CSS rules. */}
      <div className="nopal-references-heading">References</div>

      {images.length > 0 && (
        <div className="nopal-references-gallery">
          {images.map((img) => (
            <div key={img.index} className="nopal-references-gallery-item">
              <img src={img.url!} alt={img.name} />
              {canManageFiles && (
                <button
                  type="button"
                  className="nopal-references-remove"
                  aria-label={`Remove ${img.name}`}
                  onClick={() => onRemoveFile?.(img.index)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <ul className="nopal-references-files">
          {others.map((file) => (
            <li key={file.index}>
              {file.url ? (
                <a
                  href={file.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {file.name}
                </a>
              ) : (
                <span style={{ flex: 1 }}>{file.name}</span>
              )}
              {canManageFiles && (
                <button
                  type="button"
                  className="nopal-references-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onRemoveFile?.(file.index)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManageFiles && (
        <button
          type="button"
          className="nopal-references-add-file"
          onClick={onAddFile}
        >
          + Add file
        </button>
      )}
    </section>
  );
}

// ── MdxRenderer ───────────────────────────────────────────────────────────────

export default function MdxRenderer({
  editorText,
  files,
  placements,
  onChange,
  csvFields,
  onCsvFieldChange,
  canManageFiles,
  onAddFile,
  onRemoveFile,
  className,
}: MdxRendererProps) {
  const workable = onChange !== undefined;

  // ── Workable-mode editing state ────────────────────────────────────────────
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState("");
  const [addingGroupIndex, setAddingGroupIndex] = useState<number | null>(null);
  const [newTaskText, setNewTaskText] = useState("");

  // ── Per-render counters ────────────────────────────────────────────────────
  // These refs are reset in the render body and incremented inside the `li` and
  // `ul` component renderers, which execute synchronously in document order
  // during React's render phase — so counts stay in sync across multiple
  // ReactMarkdown segments without any extra bookkeeping.
  const taskCountRef = useRef(0);
  const groupCountRef = useRef(0);

  // Reset at the top of each render pass
  taskCountRef.current = 0;
  groupCountRef.current = 0;

  // ── Segments (memoised — only rebuilds when text/placements change) ────────
  const segments = useMemo(
    () => buildSegments(editorText, placements),
    [editorText, placements],
  );

  // ── React-markdown component overrides ────────────────────────────────────
  // Defined inline so every closure captures the current render's state values.
  // Accepted tradeoff: ReactMarkdown children remount on each editing-state
  // change. This is fine for personal-vault documents (small, infrequent edits).
  const components = {
    // ── Unordered list ───────────────────────────────────────────────────────
    ul({ className, children, ordered, ...rest }: any) {
      const isTaskList = className === "contains-task-list";

      if (!isTaskList) {
        return (
          <ul className={className} {...rest}>
            {children}
          </ul>
        );
      }

      const gi = groupCountRef.current++;
      const isAdding = workable && addingGroupIndex === gi;

      const handleAddCommit = (text: string) => {
        if (!text.trim() || !onChange) {
          setAddingGroupIndex(null);
          setNewTaskText("");
          return;
        }
        const groups = getTaskGroups(editorText);
        const g = groups[gi];
        // Insert after the last task in this group; if group is somehow not
        // found fall back to appending at the end of the document.
        const lastTaskIdx = g ? g.startTaskIndex + g.count - 1 : -1;
        onChange(addTaskAfterTask(editorText, lastTaskIdx, text));
        setAddingGroupIndex(null);
        setNewTaskText("");
      };

      return (
        <ul className="contains-task-list nopal-task-list" {...rest}>
          {children}
          {workable &&
            (isAdding ? (
              // Input row — matches the layout of a task item
              <li className="nopal-add-task-item">
                <div className="nopal-add-task-input-row">
                  <span className="nopal-task-checkbox-placeholder" />
                  <input
                    autoFocus
                    className="nopal-add-task-input"
                    value={newTaskText}
                    placeholder="New task…"
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCommit(newTaskText);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setAddingGroupIndex(null);
                        setNewTaskText("");
                      }
                    }}
                    onBlur={() => handleAddCommit(newTaskText)}
                  />
                </div>
              </li>
            ) : (
              <li className="nopal-add-task-item">
                <button
                  type="button"
                  className="nopal-add-task-btn"
                  onClick={() => {
                    setAddingGroupIndex(gi);
                    setNewTaskText("");
                  }}
                >
                  + Add task
                </button>
              </li>
            ))}
        </ul>
      );
    },

    // ── List item ────────────────────────────────────────────────────────────
    li({
      node,
      className,
      children,
      checked: checkedProp,
      ordered,
      ...rest
    }: any) {
      const isTask = className === "task-list-item";

      if (!isTask) {
        return (
          <li className={className} {...rest}>
            {children}
          </li>
        );
      }

      const ti = taskCountRef.current++;
      // react-markdown v8 surfaces `checked` as a direct prop on task-list <li>s.
      // v9 dropped it; fall back to reading the hast node's first child
      // (the injected <input type="checkbox">) in case we ever upgrade.
      const checked =
        checkedProp === true ||
        (node as any)?.children?.[0]?.properties?.checked === true;
      const isEditing = workable && editingTaskIndex === ti;

      return (
        <li className="nopal-task-item">
          {/* Checkbox — clickable button in workable mode, display-only span in view mode */}
          {workable ? (
            <button
              type="button"
              className={`nopal-task-checkbox${checked ? " checked" : ""}`}
              aria-label={checked ? "Uncheck task" : "Check task"}
              onClick={() => onChange!(toggleTask(editorText, ti, !checked))}
            />
          ) : (
            <span
              className={`nopal-task-checkbox${checked ? " checked" : ""}`}
              role="checkbox"
              aria-checked={checked}
            />
          )}

          {/* Task text — input while editing, clickable span otherwise */}
          {isEditing ? (
            <input
              autoFocus
              className="nopal-task-edit-input"
              value={editingTaskDraft}
              onChange={(e) => setEditingTaskDraft(e.target.value)}
              onBlur={() => {
                if (onChange)
                  onChange(editTaskText(editorText, ti, editingTaskDraft));
                setEditingTaskIndex(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (onChange)
                    onChange(editTaskText(editorText, ti, editingTaskDraft));
                  setEditingTaskIndex(null);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingTaskIndex(null);
                }
              }}
            />
          ) : (
            <span
              className={`nopal-task-text${checked ? " nopal-task-text--checked" : ""}`}
              onClick={
                workable
                  ? () => {
                      setEditingTaskIndex(ti);
                      setEditingTaskDraft(getTaskText(editorText, ti));
                    }
                  : undefined
              }
              style={workable ? { cursor: "text" } : undefined}
            >
              {/* `children` includes the null from the suppressed <input> renderer
                  as its first slot; React silently skips null children. */}
              {children}
            </span>
          )}

          {/* Delete button — workable mode only, fades in on row hover */}
          {workable && (
            <button
              type="button"
              className="nopal-task-delete"
              aria-label="Remove task"
              onClick={() => {
                if (onChange) onChange(removeTask(editorText, ti));
                if (editingTaskIndex === ti) setEditingTaskIndex(null);
              }}
            >
              ×
            </button>
          )}
        </li>
      );
    },

    // ── Suppress native GFM checkbox — our li renderer renders its own ───────
    input({ type, ...rest }: any) {
      if (type === "checkbox") return null;
      return <input type={type} {...rest} />;
    },

    // ── Inline span — intercept CSV ref placeholders injected by preprocessCsvRefs
    span({ node, className, children, ...rest }: any) {
      if (className === "nopal-csv-placeholder") {
        // hast converts data-csv-key → dataCsvKey in properties
        const encoded = (node as any)?.properties?.dataCsvKey ?? "";
        const csvKey = encoded ? decodeURIComponent(String(encoded)) : "";
        if (!csvKey || !csvFields) return null;
        const value = csvFields[csvKey] ?? "";
        return (
          <CsvChip
            csvKey={csvKey}
            value={value}
            editable={workable && !!onCsvFieldChange}
            onChange={onCsvFieldChange}
          />
        );
      }
      return (
        <span className={className} {...rest}>
          {children}
        </span>
      );
    },

    // ── Code blocks (no syntax highlighting) ────────────────────────────────
    pre({ children }: any) {
      return <pre className="nopal-code-block">{children}</pre>;
    },

    code({ className, children, inline, ...rest }: any) {
      const isBlock = !!className?.startsWith("language-");
      if (isBlock) {
        // Rendered inside our .nopal-code-block pre; .nopal-code-lang resets
        // the inherited inline-code background from .nopal-content code { }.
        return (
          <code className={`nopal-code-lang ${className}`} {...rest}>
            {children}
          </code>
        );
      }
      // Inline code — inherits .nopal-content code { } styles
      return <code {...rest}>{children}</code>;
    },

    // ── Links — open external URLs in a new tab ──────────────────────────────
    a({ href, children, target, rel, ...rest }: any) {
      const isExternal = typeof href === "string" && href.startsWith("http");
      return (
        <a
          href={href}
          target={isExternal ? "_blank" : target}
          rel={isExternal ? "noopener noreferrer" : rel}
          {...rest}
        >
          {children}
        </a>
      );
    },
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`nopal-content${className ? ` ${className}` : ""}`}>
      {segments.map((seg, i) =>
        seg.type === "images" ? (
          <ImageBlock
            key={`img-${i}`}
            fileIndices={seg.fileIndices}
            files={files}
          />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={components as any}
          >
            {csvFields ? preprocessCsvRefs(seg.text, csvFields) : seg.text}
          </ReactMarkdown>
        ),
      )}
      <ReferencesSection
        files={files}
        placements={placements}
        canManageFiles={canManageFiles}
        onAddFile={onAddFile}
        onRemoveFile={onRemoveFile}
      />
    </div>
  );
}
