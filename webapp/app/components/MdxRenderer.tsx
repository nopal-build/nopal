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
 * Mode detection: when `dispatch` is present → workable mode.
 */

import "../styles/mdxeditor.css";

import type { Dispatch } from "react";
import type { NopalFileEntry } from "../util/nopalMarkdown";
import {
  EditorState,
  EditorCommand,
  EditorNode,
  NodeKey,
  RootNode,
  ProseNode,
  TaskGroupNode,
  TaskItemNode,
  ImagePlacementNode,
  getNode,
  getPlacedFileIndices,
} from "../util/nopalEditorState";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useState, useMemo } from "react";

// ── Public props interface ─────────────────────────────────────────────────────

export interface MdxRendererProps {
  state: EditorState;
  dispatch?: Dispatch<EditorCommand>; // absent → view mode (read-only)
  csvFields?: Record<string, string>;
  onCsvFieldChange?: (key: string, value: string) => void;
  canManageFiles?: boolean;
  onAddFile?: () => void;
  onRemoveFile?: (fileIndex: number) => void;
  className?: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
  files: ReadonlyArray<NopalFileEntry>;
  placedFileIndices: Set<number>;
  canManageFiles?: boolean;
  onAddFile?: () => void;
  onRemoveFile?: (fileIndex: number) => void;
}

function ReferencesSection({
  files,
  placedFileIndices,
  canManageFiles,
  onAddFile,
  onRemoveFile,
}: ReferencesSectionProps) {
  const placedSet = placedFileIndices;
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

// ── TaskItemView ──────────────────────────────────────────────────────────────

interface TaskItemViewProps {
  state: EditorState;
  taskKey: NodeKey;
  groupKey: NodeKey;
  dispatch?: Dispatch<EditorCommand>;
}

function TaskItemView({
  state,
  taskKey,
  groupKey,
  dispatch,
}: TaskItemViewProps) {
  const task = getNode<TaskItemNode>(state, taskKey, "task-item");
  const [isEditing, setIsEditing] = useState(false);
  const [editingDraft, setEditingDraft] = useState("");
  if (!task) return null;

  const commitEdit = () => {
    if (dispatch && editingDraft.trim())
      dispatch({
        type: "EDIT_TASK_TEXT",
        groupKey,
        taskKey,
        text: editingDraft,
      });
    setIsEditing(false);
  };

  return (
    <li className="nopal-task-item">
      {dispatch ? (
        <button
          type="button"
          className={`nopal-task-checkbox${task.checked ? " checked" : ""}`}
          aria-label={task.checked ? "Uncheck task" : "Check task"}
          onClick={() =>
            dispatch({
              type: "TOGGLE_TASK",
              groupKey,
              taskKey,
              checked: !task.checked,
            })
          }
        />
      ) : (
        <span
          className={`nopal-task-checkbox${task.checked ? " checked" : ""}`}
          role="checkbox"
          aria-checked={task.checked}
        />
      )}

      {isEditing ? (
        <input
          autoFocus
          className="nopal-task-edit-input"
          value={editingDraft}
          onChange={(e) => setEditingDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <span
          className={`nopal-task-text${task.checked ? " nopal-task-text--checked" : ""}`}
          onClick={
            dispatch
              ? () => {
                  setIsEditing(true);
                  setEditingDraft(task.text);
                }
              : undefined
          }
          style={dispatch ? { cursor: "text" } : undefined}
        >
          {task.text}
        </span>
      )}

      {dispatch && (
        <button
          type="button"
          className="nopal-task-delete"
          aria-label="Remove task"
          onClick={() => dispatch({ type: "REMOVE_TASK", groupKey, taskKey })}
        >
          ×
        </button>
      )}
    </li>
  );
}

// ── TaskGroupView ─────────────────────────────────────────────────────────────

interface TaskGroupViewProps {
  state: EditorState;
  groupKey: NodeKey;
  dispatch?: Dispatch<EditorCommand>;
}

function TaskGroupView({ state, groupKey, dispatch }: TaskGroupViewProps) {
  const group = getNode<TaskGroupNode>(state, groupKey, "task-group");
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  if (!group) return null;

  const commitAdd = (text: string) => {
    if (text.trim() && dispatch) {
      const lastKey = group.children[group.children.length - 1] ?? null;
      dispatch({ type: "ADD_TASK", groupKey, afterKey: lastKey, text });
    }
    setIsAdding(false);
    setNewTaskText("");
  };

  return (
    <ul className="contains-task-list nopal-task-list">
      {group.children.map((taskKey) => (
        <TaskItemView
          key={taskKey}
          state={state}
          taskKey={taskKey}
          groupKey={groupKey}
          dispatch={dispatch}
        />
      ))}
      {dispatch &&
        (isAdding ? (
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
                    commitAdd(newTaskText);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsAdding(false);
                    setNewTaskText("");
                  }
                }}
                onBlur={() => commitAdd(newTaskText)}
              />
            </div>
          </li>
        ) : (
          <li className="nopal-add-task-item">
            <button
              type="button"
              className="nopal-add-task-btn"
              onClick={() => {
                setIsAdding(true);
                setNewTaskText("");
              }}
            >
              Add task
            </button>
          </li>
        ))}
    </ul>
  );
}

// ── MdxRenderer ───────────────────────────────────────────────────────────────

type RenderSegment =
  | { type: "prose"; key: NodeKey }
  | { type: "task-group"; key: NodeKey }
  | { type: "images"; fileIndices: number[] };

export default function MdxRenderer({
  state,
  dispatch,
  csvFields,
  onCsvFieldChange,
  canManageFiles,
  onAddFile,
  onRemoveFile,
  className,
}: MdxRendererProps) {
  // ── Build render segments ──────────────────────────────────────────────────
  const renderSegments = useMemo((): RenderSegment[] => {
    const root = state.nodes.get("root") as RootNode | undefined;
    if (!root) return [];

    const segments: RenderSegment[] = [];
    let pendingImages: number[] = [];

    for (const childKey of root.children) {
      const node = state.nodes.get(childKey);
      if (!node) continue;

      if (node.type === "image-placement") {
        pendingImages.push((node as ImagePlacementNode).fileIndex);
      } else {
        if (pendingImages.length > 0) {
          segments.push({ type: "images", fileIndices: pendingImages });
          pendingImages = [];
        }
        if (node.type === "task-group") {
          segments.push({ type: "task-group", key: childKey });
        } else if (node.type === "prose") {
          segments.push({ type: "prose", key: childKey });
        }
      }
    }

    if (pendingImages.length > 0) {
      segments.push({ type: "images", fileIndices: pendingImages });
    }

    return segments;
  }, [state]);

  // ── React-markdown component overrides ────────────────────────────────────
  // Memoised so that react-markdown's component functions keep stable
  // references across parent re-renders.
  // The memo only busts when a value the closures actually read changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const components = useMemo(
    () => ({
      // ── Suppress native GFM checkbox — TaskItemView renders its own ──────────
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
              editable={dispatch !== undefined && !!onCsvFieldChange}
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [dispatch, csvFields, onCsvFieldChange],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`nopal-content${className ? ` ${className}` : ""}`}>
      {renderSegments.map((seg, i) => {
        if (seg.type === "images")
          return (
            <ImageBlock
              key={`img-${i}`}
              fileIndices={seg.fileIndices}
              files={state.files as NopalFileEntry[]}
            />
          );
        if (seg.type === "task-group")
          return (
            <TaskGroupView
              key={seg.key}
              state={state}
              groupKey={seg.key}
              dispatch={dispatch}
            />
          );
        // prose
        const node = state.nodes.get(seg.key) as ProseNode;
        const text = csvFields
          ? preprocessCsvRefs(node.content, csvFields)
          : node.content;
        return (
          <ReactMarkdown
            key={seg.key}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={components as any}
          >
            {text}
          </ReactMarkdown>
        );
      })}
      <ReferencesSection
        files={state.files}
        placedFileIndices={getPlacedFileIndices(state)}
        canManageFiles={canManageFiles}
        onAddFile={onAddFile}
        onRemoveFile={onRemoveFile}
      />
    </div>
  );
}
