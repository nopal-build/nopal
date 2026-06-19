/**
 * MdxEditorWorkable — markdown display with task interactivity and file management.
 *
 * Main content (headings, paragraphs, blockquotes, code, links) is read-only.
 * Tasks (checklist items) are fully interactive: toggle, edit text, add, remove.
 * Unplaced files can be added or removed via the References section.
 * CSV value chips are editable if onCsvFieldChange is provided.
 *
 * Visually identical to MdxEditorEditable.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
} from "react";
import {
  importFromMarkdown,
  exportToMarkdown,
  editorReducer,
  type EditorState,
  type EditorCommand,
} from "../util/nopalEditorState";
import MdxRenderer from "./MdxRenderer";
import type { VaultRefItem } from "./refPopoverPlugin";

interface MdxEditorWorkableProps {
  markdown: string;
  onChange: (md: string) => void;
  uploadFile?: (file: File) => Promise<string>;
  csvFields?: Record<string, string>;
  onCsvFieldChange?: (key: string, value: string) => void;
  /** Vault items for resolving [[wiki-links]] and ![[embeds]]. */
  wikiItems?: VaultRefItem[];
  /** Called when the user clicks an unresolved [[wiki-link]] to create it. */
  onWikiLinkCreate?: (label: string) => void;
}

interface UploadingFile {
  index: number;
  name: string; // original file name (for display)
  isImage: boolean;
}

const IMAGE_MIME = /^image\//i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i;

export default function MdxEditorWorkable({
  markdown,
  onChange,
  uploadFile,
  csvFields,
  onCsvFieldChange,
  wikiItems,
  onWikiLinkCreate,
}: MdxEditorWorkableProps) {
  // Primary editor state — useReducer with lazy initializer
  const [editorState, dispatch] = useReducer(
    editorReducer,
    markdown,
    importFromMarkdown,
  );

  // Uploading files — local state only (not in EditorState until upload completes)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const nextIndexRef = useRef(
    editorState.files.length > 0
      ? Math.max(...editorState.files.map((f) => f.index)) + 1
      : 1,
  );

  // ── Emit changes to parent ─────────────────────────────────────────────────

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    onChange(exportToMarkdown(editorState));
  }, [editorState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Display state (ready files + uploading placeholders for ReferencesSection) ──

  const displayState = useMemo<EditorState>(
    () => ({
      ...editorState,
      files: [
        ...editorState.files,
        ...uploadingFiles.map((f) => ({
          index: f.index,
          url: null,
          name: `Uploading ${f.name}…`,
          isImage: f.isImage,
        })),
      ],
    }),
    [editorState, uploadingFiles],
  );

  // ── File management ────────────────────────────────────────────────────────

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAddFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!list.length || !uploadFile) return;

      const startIdx = nextIndexRef.current;
      nextIndexRef.current += list.length;

      // Add uploading placeholders
      list.forEach((file, i) => {
        const isImage = IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name);
        setUploadingFiles((prev) => [
          ...prev,
          { index: startIdx + i, name: file.name, isImage },
        ]);
      });

      // Upload each file concurrently
      await Promise.all(
        list.map(async (file, i) => {
          const isImage =
            IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name);
          try {
            const url = await uploadFile(file);
            dispatch({
              type: "ADD_FILE",
              file: { index: startIdx + i, url, name: file.name, isImage },
            });
            setUploadingFiles((prev) =>
              prev.filter((f) => f.index !== startIdx + i),
            );
          } catch (err) {
            console.error("Upload error:", err);
            setUploadingFiles((prev) =>
              prev.filter((f) => f.index !== startIdx + i),
            );
          }
        }),
      );
    },
    [uploadFile],
  );

  const handleRemoveFile = useCallback(
    (fileIndex: number) => {
      if (uploadingFiles.some((f) => f.index === fileIndex)) {
        setUploadingFiles((prev) => prev.filter((f) => f.index !== fileIndex));
      } else {
        dispatch({ type: "REMOVE_FILE", fileIndex });
      }
    },
    [uploadingFiles],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <MdxRenderer
        state={displayState}
        dispatch={dispatch}
        csvFields={csvFields}
        onCsvFieldChange={onCsvFieldChange}
        canManageFiles={!!uploadFile}
        onAddFile={handleAddFile}
        onRemoveFile={handleRemoveFile}
        wikiItems={wikiItems}
        onWikiLinkCreate={onWikiLinkCreate}
      />
      {uploadFile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />
      )}
    </div>
  );
}
