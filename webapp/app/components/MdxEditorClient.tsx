import "@mdxeditor/editor/style.css";
import "../styles/mdxeditor.css";

import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  tablePlugin,
  realmPlugin,
  addComposerChild$,
  addImportVisitor$,
} from "@mdxeditor/editor";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  INSERT_PARAGRAPH_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_SPACE_COMMAND,
} from "lexical";
import { INSERT_CHECK_LIST_COMMAND } from "@lexical/list";
import { $isQuoteNode } from "@lexical/rich-text";
import { $findMatchingParent } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { csvRefPlugin, CsvFieldsContext } from "./csvRefPlugin";
import {
  refPopoverPlugin,
  RefPopoverContext,
  type VaultRefItem,
} from "./refPopoverPlugin";
import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

const IMAGE_MIME = /^image\//i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i;

const NOPAL_MARKER = "\n\n# Nopal Markdown\nFiles";
const FILE_LINE_RE = /^\[(\d+)\]\s+(.+)$/;
const STACK_THRESHOLD = 32;
const PLACEMENT_RE = /^\[nopal-image\]\[(\d+)\]$|^\[(\d+)\]$/;

// ── SVG data URIs ────────────────────────────────────────────────────────────

const FILE_ICON_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="18" fill="#a78bfa"/><path d="M13 10h6l5 5v11a1 1 0 0 1-1 1H13a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1z" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="19 10 19 15 24 15" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}`;

const TRAY_LOADING_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="none" stroke="#e0daea" stroke-width="2"/><path d="M14 3 A11 11 0 0 1 25 14" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 14 14" to="360 14 14" dur="0.85s" repeatCount="indefinite"/></path></svg>`,
)}`;

const TRAY_FILE_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H8a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="16 3 16 9 22 9"/></svg>`,
)}`;

// ── URL-embed helpers ────────────────────────────────────────────────────────

const BARE_URL_RE = /^https?:\/\/\S+$/i;
// Detects structural markdown at the start of any line: headings, list items,
// blockquotes, code fences, and GFM tables. Inline markup (bold, italic) is
// intentionally excluded — Lexical handles those fine as plain text.
const MARKDOWN_STRUCTURAL_RE = /^(#{1,6} |[-*+] |\d+\.\s|> |```|\|.+\|)/m;
const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*?&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/;

function buildVideoEmbed(url: string): string | null {
  const yt = url.match(YOUTUBE_RE);
  if (yt) {
    return (
      `<iframe width="560" height="315" ` +
      `src="https://www.youtube.com/embed/${yt[1]}" ` +
      `title="YouTube video" frameBorder="0" ` +
      `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
      `allowFullScreen />`
    );
  }
  const vm = url.match(VIMEO_RE);
  if (vm) {
    return (
      `<iframe src="https://player.vimeo.com/video/${vm[1]}" ` +
      `width="560" height="315" frameBorder="0" ` +
      `allow="autoplay; fullscreen; picture-in-picture" ` +
      `allowFullScreen title="Vimeo video" />`
    );
  }
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditorHandle {
  insertMarkdown: (markdown: string) => void;
  addFiles: (files: File[]) => Promise<void>;
}

interface FileEntry {
  index: number;
  url: string | null;
  name: string;
  isImage: boolean;
  status: "uploading" | "ready";
}

interface ImagePlacement {
  fileIndex: number;
  afterParagraphIndex: number;
}

interface MdxEditorClientProps {
  markdown: string;
  onChange: (md: string) => void;
  uploadFile?: (file: File) => Promise<string>;
  onEditorReady?: (handle: EditorHandle) => void;
  actions?: ReactNode;
  /**
   * key → value data from a sibling CSV file (e.g. a project's project.csv).
   * When provided, `[key]` references in the markdown render as inline,
   * click-to-edit value chips.
   */
  csvFields?: Record<string, string>;
  /** Called when a CSV value chip is edited inline. */
  onCsvFieldChange?: (key: string, value: string) => void;
  /**
   * Vault items offered by the `[` reference popover (pages, photos, files).
   * Together with csvFields these power the typeahead; either prop alone
   * also activates it.
   */
  refItems?: VaultRefItem[];
}

// ── Document parsing / serialization ─────────────────────────────────────────

function parseDocument(raw: string): {
  userContent: string;
  files: FileEntry[];
} {
  const idx = raw.indexOf(NOPAL_MARKER);
  if (idx === -1) return { userContent: raw, files: [] };

  const userContent = raw.slice(0, idx);
  const registrySection = raw.slice(idx + NOPAL_MARKER.length);
  const files: FileEntry[] = [];

  for (const line of registrySection.split("\n")) {
    const m = line.match(FILE_LINE_RE);
    if (!m) continue;
    const index = parseInt(m[1]);
    const value = m[2].trim();
    const isUrl = value.startsWith("http");
    files.push({
      index,
      url: isUrl ? value : null,
      name: value,
      isImage: isUrl ? IMAGE_EXT.test(value) : false,
      status: isUrl ? "ready" : "uploading",
    });
  }

  return { userContent, files };
}

function serializeDocument(userContent: string, files: FileEntry[]): string {
  if (files.length === 0) return userContent;
  const lines = files.map((f) => `[${f.index}] ${f.url ?? f.name}`);
  return `${userContent.trimEnd()}${NOPAL_MARKER}\n${lines.join("\n")}`;
}

function parseUserContent(content: string): {
  editorText: string;
  placements: ImagePlacement[];
} {
  const paras = content.split("\n\n");
  const clean: string[] = [];
  const placements: ImagePlacement[] = [];

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

function buildUserContent(
  editorText: string,
  placements: ImagePlacement[],
): string {
  // Split and trim only trailing empty segments so that internal blank
  // paragraphs (extra spacing between content) are preserved but trailing
  // empty lines added by the editor cursor do not accumulate.
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

// ── Blockquote Enter plugin ──────────────────────────────────────────────────
// Lexical's QuoteNode.insertNewAfter() always exits the blockquote by creating
// a ParagraphNode. We intercept INSERT_PARAGRAPH_COMMAND at high priority so:
//   • Non-empty blockquote line → split and stay inside the blockquote.
//   • Empty blockquote line    → replace with a paragraph (exit blockquote).

function BlockquoteEnterPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        const anchorNode = selection.anchor.getNode();
        const quoteNode = $findMatchingParent(anchorNode, $isQuoteNode);
        if (!quoteNode) return false;

        // Find the direct child of the QuoteNode that contains the cursor
        // (typically a ParagraphNode — the <p> inside the <blockquote>).
        const directChild = $findMatchingParent(
          anchorNode,
          (node) => node.getParent()?.getKey() === quoteNode.getKey(),
        );

        // Only intercept when that block is empty (double-Enter to exit).
        // For non-empty blocks, return false so Lexical's default handler
        // creates a new sibling ParagraphNode inside the QuoteNode.
        if (directChild && directChild.getTextContent() === "") {
          directChild.remove();
          const paragraph = $createParagraphNode();
          if (quoteNode.isEmpty()) {
            quoteNode.replace(paragraph);
          } else {
            quoteNode.insertAfter(paragraph);
          }
          paragraph.selectStart();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

const blockquoteEnterPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, BlockquoteEnterPlugin);
  },
});

// Prevent the space key from toggling checklist checkboxes.
// @lexical/list registers KEY_SPACE_COMMAND at COMMAND_PRIORITY_LOW and
// toggles the checkbox whenever a checklist <li> has DOM focus. Intercept
// at higher priority and return focus to the editor so the user can type.
function NoChecklistSpacePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_SPACE_COMMAND,
      (_event) => {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active.tagName === "LI" &&
          active.parentElement != null &&
          (active.parentElement as any).__lexicalListType === "check"
        ) {
          editor.getRootElement()?.focus();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

// ── Blank-line preservation plugin ─────────────────────────────────────────
// remark's fromMarkdown discards extra blank lines between top-level blocks
// (they are just separator whitespace in MDAST). We replace the default root
// visitor with a higher-priority one that reads the position metadata emitted
// by fromMarkdown and re-injects the correct number of empty Lexical
// paragraphs between nodes wherever the original markdown had extra gaps.
const blankLinesPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, {
      testNode: "root",
      priority: 10, // beats the built-in MdastRootVisitor (priority 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visitNode({ mdastNode, lexicalParent, actions }: any) {
        const children: any[] = mdastNode.children ?? [];
        for (let i = 0; i < children.length; i++) {
          // Visit this child by wrapping it in a one-item fake root so that
          // visitChildren iterates just this node.
          actions.visitChildren({ children: [children[i]] }, lexicalParent);

          // Insert empty paragraphs for every extra blank line between this
          // node and the next one. Standard paragraph separation uses a gap
          // of 2 lines; each additional blank adds 2 more lines to the gap.
          if (i < children.length - 1) {
            const currEnd: number = children[i].position?.end?.line ?? 0;
            const nextStart: number =
              children[i + 1].position?.start?.line ?? 0;
            if (currEnd > 0 && nextStart > 0) {
              const extra = Math.max(
                0,
                Math.round((nextStart - currEnd - 2) / 2),
              );
              for (let j = 0; j < extra; j++) {
                lexicalParent.append($createParagraphNode());
              }
            }
          }
        }
      },
    });
  },
});

const noChecklistSpacePlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, NoChecklistSpacePlugin);
  },
});

// ── Lexical editor capture plugin ────────────────────────────────────────────
// Exposes the underlying LexicalEditor instance so the action bar can dispatch
// commands (e.g. INSERT_CHECK_LIST_COMMAND) without going through markdown.
type LexicalEditor = ReturnType<typeof useLexicalComposerContext>[0];

function makeLexicalCapturePlugin(ref: { current: LexicalEditor | null }) {
  function LexicalCaptureInner() {
    const [editor] = useLexicalComposerContext();
    ref.current = editor;
    return null;
  }
  return realmPlugin({
    init(realm) {
      realm.pub(addComposerChild$, LexicalCaptureInner);
    },
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MdxEditorClient({
  markdown,
  onChange,
  uploadFile,
  onEditorReady,
  actions,
  csvFields,
  onCsvFieldChange,
  refItems,
}: MdxEditorClientProps) {
  // Whether CSV references / the reference popover are enabled is fixed at
  // mount (the plugin list is static).
  const [csvEnabled] = useState(csvFields != null);
  const [popoverEnabled] = useState(csvFields != null || refItems != null);
  const [initialState] = useState(() => {
    const { userContent, files } = parseDocument(markdown);
    const { editorText, placements } = parseUserContent(userContent);
    const nextIndex =
      files.length > 0 ? Math.max(...files.map((f) => f.index)) + 1 : 1;
    return { editorText, placements, files, nextIndex };
  });

  const [files, setFiles] = useState<FileEntry[]>(initialState.files);
  const [editorText, setEditorText] = useState<string>(initialState.editorText);
  const [placements, setPlacements] = useState<ImagePlacement[]>(
    initialState.placements,
  );
  const [chipPositions, setChipPositions] = useState<
    Array<{ fileIndex: number; y: number }>
  >([]);
  const [expandedGroupKey, setExpandedGroupKey] = useState<number | null>(null);

  const nextIndexRef = useRef(initialState.nextIndex);
  const filesRef = useRef<FileEntry[]>(initialState.files);
  const editorTextRef = useRef(initialState.editorText);
  const placementsRef = useRef<ImagePlacement[]>(initialState.placements);
  /** Tracks the snap-point index chosen by the last dragover event. */
  const snappedBlocksAboveRef = useRef<number>(0);
  /** Always holds the latest addFilesCore so the stable EditorHandle can call it. */
  const addFilesCoreRef = useRef<(files: File[]) => Promise<void>>(
    async () => {},
  );

  const editorRef = useRef<MDXEditorMethods>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  // Stable plugin instance — created once so the Lexical composer isn't remounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lexicalCapturePlugin = useMemo(
    () => makeLexicalCapturePlugin(lexicalEditorRef),
    [],
  );

  // "file"  = dragging a tray item onto the editor   → full-width drop zone
  // "chip"  = dragging a placed chip to reposition  → narrow right-edge strip
  // "none"  = not dragging
  const [dragType, setDragType] = useState<"none" | "file" | "chip">("none");
  const [dotY, setDotY] = useState(0);

  // ── Keep refs in sync ───────────────────────────────────────────────────
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    editorTextRef.current = editorText;
  }, [editorText]);
  useEffect(() => {
    placementsRef.current = placements;
  }, [placements]);

  // ── Notify parent ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const userContent = buildUserContent(editorText, placements);
    onChange(serializeDocument(userContent, files));
  }, [editorText, placements, files, onChange]);

  // ── Core upload logic (used by + button and exposed EditorHandle) ───────
  const addFilesCore = useCallback(
    async (fileList: File[]) => {
      if (!fileList.length || !uploadFile) return;

      const startIndex = nextIndexRef.current;
      nextIndexRef.current += fileList.length;

      const placeholders: FileEntry[] = fileList.map((file, i) => ({
        index: startIndex + i,
        url: null,
        name:
          fileList.length === 1
            ? `Uploading ${file.name}…`
            : `Uploading ${i + 1} of ${fileList.length}…`,
        isImage: IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name),
        status: "uploading" as const,
      }));

      setFiles((prev) => {
        const updated = [...prev, ...placeholders];
        filesRef.current = updated;
        return updated;
      });

      await Promise.all(
        fileList.map(async (file, i) => {
          try {
            const url = await uploadFile(file);
            const isImage =
              IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name);
            setFiles((prev) => {
              const updated = prev.map((f) =>
                f.index === startIndex + i
                  ? {
                      ...f,
                      url,
                      name: file.name,
                      isImage,
                      status: "ready" as const,
                    }
                  : f,
              );
              filesRef.current = updated;
              return updated;
            });
          } catch (err) {
            console.error("Upload error:", err);
          }
        }),
      );
    },
    [uploadFile],
  );

  useEffect(() => {
    addFilesCoreRef.current = addFilesCore;
  }, [addFilesCore]);

  // ── Embed an existing vault image (no upload — it already has a URL) ────
  // Used by the `[` reference popover: registers the image in the file
  // registry and places it at the given paragraph gap.
  const embedImage = useCallback(
    (item: VaultRefItem, afterParagraphIndex: number) => {
      if (!item.url) return;
      const index = nextIndexRef.current++;
      setFiles((prev) => {
        const updated: FileEntry[] = [
          ...prev,
          {
            index,
            url: item.url ?? null,
            name: item.label,
            isImage: true,
            status: "ready" as const,
          },
        ];
        filesRef.current = updated;
        return updated;
      });
      setPlacements((prev) => [
        ...prev,
        { fileIndex: index, afterParagraphIndex },
      ]);
    },
    [],
  );

  // ── Expose imperative handle ────────────────────────────────────────────
  useEffect(() => {
    if (onEditorReady) {
      onEditorReady({
        insertMarkdown: (md: string) => editorRef.current?.insertMarkdown(md),
        addFiles: (files: File[]) => addFilesCoreRef.current(files),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Global dragover tracking — snaps dot to paragraph-gap positions ────
  useEffect(() => {
    if (dragType === "none") return;
    const onMove = (e: DragEvent) => {
      const containerRect = editorContainerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const bodyEl = editorBodyRef.current;
      const contentEl = bodyEl?.querySelector('[contenteditable="true"]');
      const blocks = contentEl
        ? (Array.from(contentEl.children) as HTMLElement[])
        : [];

      const rawY = e.clientY - containerRect.top;

      if (blocks.length === 0) {
        setDotY(Math.max(0, Math.min(rawY, containerRect.height)));
        snappedBlocksAboveRef.current = 0;
        return;
      }

      // Build N+1 snap points: before block 0, between each adjacent pair,
      // and after the last block.  snapPoints[i] is the Y where inserting
      // AFTER paragraph i-1 would visually land.
      const snapPoints: number[] = [];
      snapPoints.push(
        blocks[0].getBoundingClientRect().top - containerRect.top,
      );
      for (let i = 0; i < blocks.length - 1; i++) {
        const b = blocks[i].getBoundingClientRect().bottom - containerRect.top;
        const t = blocks[i + 1].getBoundingClientRect().top - containerRect.top;
        snapPoints.push((b + t) / 2);
      }
      snapPoints.push(
        blocks[blocks.length - 1].getBoundingClientRect().bottom -
          containerRect.top,
      );

      // Find the nearest snap point
      let bestIdx = 0;
      let bestDist = Math.abs(snapPoints[0] - rawY);
      for (let i = 1; i < snapPoints.length; i++) {
        const d = Math.abs(snapPoints[i] - rawY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      setDotY(snapPoints[bestIdx]);
      snappedBlocksAboveRef.current = bestIdx;
    };
    document.addEventListener("dragover", onMove);
    return () => document.removeEventListener("dragover", onMove);
  }, [dragType]);

  // ── Chip position computation ───────────────────────────────────────────
  useLayoutEffect(() => {
    const containerEl = editorContainerRef.current;
    const bodyEl = editorBodyRef.current;
    const contentEl = bodyEl?.querySelector('[contenteditable="true"]');
    if (!containerEl || !contentEl) return;

    const blocks = Array.from(contentEl.children) as HTMLElement[];
    const containerRect = containerEl.getBoundingClientRect();

    const positions = placements.map(({ fileIndex, afterParagraphIndex }) => {
      const prev = blocks[afterParagraphIndex - 1];
      const next = blocks[afterParagraphIndex];
      let y: number;

      if (prev && next) {
        y =
          (prev.getBoundingClientRect().bottom +
            next.getBoundingClientRect().top) /
            2 -
          containerRect.top;
      } else if (prev) {
        y = prev.getBoundingClientRect().bottom - containerRect.top + 14;
      } else if (next) {
        y = next.getBoundingClientRect().top - containerRect.top - 14;
      } else {
        y = 36;
      }

      return { fileIndex, y };
    });

    setChipPositions(positions);
  }, [placements, editorText]);

  // ── Derived state ───────────────────────────────────────────────────────

  const placedIndices = useMemo(
    () => new Set(placements.map((p) => p.fileIndex)),
    [placements],
  );

  const trayFiles = useMemo(
    () => files.filter((f) => !placedIndices.has(f.index)),
    [files, placedIndices],
  );

  const chipGroups = useMemo(() => {
    const sorted = [...chipPositions].sort((a, b) => a.y - b.y);
    const groups: Array<{
      key: number;
      baseY: number;
      chips: Array<{ fileIndex: number; y: number }>;
    }> = [];

    for (const chip of sorted) {
      const last = groups[groups.length - 1];
      if (last && chip.y - last.baseY < STACK_THRESHOLD) {
        last.chips.push(chip);
      } else {
        groups.push({ key: chip.fileIndex, baseY: chip.y, chips: [chip] });
      }
    }
    return groups;
  }, [chipPositions]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = Array.from(e.target.files ?? []);
      e.target.value = "";
      await addFilesCore(fileList);
    },
    [addFilesCore],
  );

  const handleTrayDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      e.dataTransfer.setData("application/x-nopal-file-index", String(index));
      e.dataTransfer.effectAllowed = "copy";
      setDragType("file");
    },
    [],
  );

  const handleTrayDragEnd = useCallback(() => setDragType("none"), []);

  const handleDropLineDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const { types } = e.dataTransfer;
      const isChip = types.includes("application/x-nopal-chip-index");
      const isFile = types.includes("application/x-nopal-file-index");
      if (!isChip && !isFile) return;
      e.preventDefault();
      // dropEffect must match the drag source's effectAllowed:
      // tray items use "copy", chip repositions use "move"
      e.dataTransfer.dropEffect = isChip ? "move" : "copy";
    },
    [],
  );

  const handleDropLineDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const chipIndexStr = e.dataTransfer.getData(
        "application/x-nopal-chip-index",
      );
      const fileIndexStr = e.dataTransfer.getData(
        "application/x-nopal-file-index",
      );
      if (!chipIndexStr && !fileIndexStr) return;
      e.preventDefault();

      const fileIndex = parseInt(chipIndexStr || fileIndexStr);
      const isReposition = !!chipIndexStr;
      setDragType("none");

      // Use the snap-point index accumulated during dragover — it already
      // corresponds to the gap between paragraphs.
      const blocksAbove = snappedBlocksAboveRef.current;

      const bodyEl = editorBodyRef.current;
      const contentEl = bodyEl?.querySelector('[contenteditable="true"]');
      const totalBlocks = contentEl ? contentEl.children.length : 0;

      const text = editorTextRef.current;
      // Include empty segments so the index aligns with buildUserContent,
      // which also keeps internal blank paragraphs.
      const allTextParas = text.split("\n\n");
      let lastNonEmpty = allTextParas.length - 1;
      while (lastNonEmpty >= 0 && allTextParas[lastNonEmpty].trim() === "")
        lastNonEmpty--;
      const paragraphs = allTextParas.slice(0, lastNonEmpty + 1);
      const afterParagraphIndex =
        totalBlocks > 0
          ? Math.min(
              Math.round((blocksAbove / totalBlocks) * paragraphs.length),
              paragraphs.length,
            )
          : paragraphs.length;

      if (isReposition) {
        // Remove the old placement and insert at the new position
        setPlacements((prev) => [
          ...prev.filter((p) => p.fileIndex !== fileIndex),
          { fileIndex, afterParagraphIndex },
        ]);
      } else {
        setPlacements((prev) => [...prev, { fileIndex, afterParagraphIndex }]);
      }
    },
    [],
  );

  const handleRemovePlacement = useCallback((fileIndex: number) => {
    setPlacements((prev) => prev.filter((p) => p.fileIndex !== fileIndex));
  }, []);

  const handleChipDragStart = useCallback(
    (e: React.DragEvent, fileIndex: number) => {
      e.dataTransfer.setData(
        "application/x-nopal-chip-index",
        String(fileIndex),
      );
      e.dataTransfer.effectAllowed = "move";
      setExpandedGroupKey(null);
      setDragType("chip");
    },
    [],
  );

  const handleChipDragEnd = useCallback(() => setDragType("none"), []);

  const handleTrayChipDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.includes("application/x-nopal-chip-index")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    },
    [],
  );

  const handleTrayChipDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const indexStr = e.dataTransfer.getData("application/x-nopal-chip-index");
      if (!indexStr) return;
      e.preventDefault();
      handleRemovePlacement(parseInt(indexStr));
    },
    [handleRemovePlacement],
  );

  const handleUserContentChange = useCallback((newMd: string) => {
    // Guard against async Lexical initialization callbacks that can fire
    // before the component is committed (Placement flag still set on the
    // fiber in concurrent mode). mountedRef becomes true in the first
    // useEffect run, which is always post-commit.
    if (!mountedRef.current) return;
    setEditorText(newMd);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain").trim();
    if (!text) return;

    const editor = editorRef.current;
    if (!editor) return;

    // Bare URL — convert to a link or video embed.
    if (BARE_URL_RE.test(text)) {
      e.preventDefault();
      e.stopPropagation();
      const videoEmbed = buildVideoEmbed(text);
      editor.insertMarkdown(
        videoEmbed ? `\n\n${videoEmbed}\n\n` : `[${text}](${text})`,
      );
      return;
    }

    // Structural markdown (headings, lists, blockquotes, code fences, tables) —
    // parse it through the editor so it renders as rich content.
    if (MARKDOWN_STRUCTURAL_RE.test(text)) {
      e.preventDefault();
      e.stopPropagation();
      editor.insertMarkdown(`\n\n${text}\n\n`);
      return;
    }

    // Plain prose — let Lexical handle it normally.
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  const csvContextValue = useMemo(
    () => ({ fields: csvFields ?? {}, onChange: onCsvFieldChange }),
    [csvFields, onCsvFieldChange],
  );

  const refPopoverContextValue = useMemo(
    () => ({ items: refItems ?? [], embedImage }),
    [refItems, embedImage],
  );

  // Memoised so MDXEditor doesn't recreate its Lexical instance on every
  // parent re-render (e.g. when setChipPositions fires from useLayoutEffect).
  const editorPlugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          "": "Plain text",
          js: "JavaScript",
          jsx: "JSX",
          ts: "TypeScript",
          tsx: "TSX",
          html: "HTML",
          css: "CSS",
          json: "JSON",
          md: "Markdown",
          py: "Python",
          sh: "Shell",
          sql: "SQL",
          yaml: "YAML",
        },
      }),
      tablePlugin(),
      markdownShortcutPlugin(),
      blankLinesPlugin(),
      blockquoteEnterPlugin(),
      noChecklistSpacePlugin(),
      lexicalCapturePlugin(),
      ...(csvEnabled ? [csvRefPlugin()] : []),
      ...(popoverEnabled ? [refPopoverPlugin()] : []),
    ],
    // csvEnabled/popoverEnabled are fixed at mount (useState initialisers),
    // so this memo effectively only runs once per component lifetime.
    [csvEnabled, popoverEnabled],
  );

  return (
    <CsvFieldsContext.Provider value={csvContextValue}>
      <RefPopoverContext.Provider value={refPopoverContextValue}>
        <div
          ref={editorContainerRef}
          style={{
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {/* Editor */}
          <div
            ref={editorBodyRef}
            className="nopal-editor-body"
            onPasteCapture={handlePaste}
          >
            <MDXEditor
              ref={editorRef}
              markdown={initialState.editorText}
              onChange={handleUserContentChange}
              plugins={editorPlugins}
            />
          </div>

          {/* Placed-file chips */}
          {chipGroups.map((group) => {
            const isStack = group.chips.length > 1;
            const isExpanded = expandedGroupKey === group.key;

            return group.chips.map((chip, i) => {
              const file = files.find((f) => f.index === chip.fileIndex);
              if (!file) return null;

              let chipY: number;
              let chipZIndex: number;

              if (!isStack) {
                chipY = chip.y;
                chipZIndex = 10;
              } else if (!isExpanded) {
                chipY = group.baseY + i * 5;
                chipZIndex = 10 + (group.chips.length - i);
              } else {
                const FAN_SPACING = 44;
                const totalSpan = (group.chips.length - 1) * FAN_SPACING;
                chipY = group.baseY - totalSpan / 2 + i * FAN_SPACING;
                chipZIndex = 10 + i;
              }

              const isTopOfCollapsedStack = isStack && !isExpanded && i === 0;

              return (
                <button
                  key={chip.fileIndex}
                  className={[
                    "nopal-image-chip",
                    isStack && !isExpanded ? "nopal-image-chip--stacked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ top: chipY, zIndex: chipZIndex }}
                  draggable
                  onDragStart={(e) => handleChipDragStart(e, chip.fileIndex)}
                  onDragEnd={handleChipDragEnd}
                  onClick={() => {
                    if (isStack && !isExpanded) {
                      setExpandedGroupKey(group.key);
                    } else if (isExpanded) {
                      setExpandedGroupKey(null);
                    }
                  }}
                  title={
                    isStack && !isExpanded
                      ? `${group.chips.length} items — click to expand`
                      : `[${chip.fileIndex}] ${file.name} — drag to tray to remove`
                  }
                >
                  {file.isImage && file.url ? (
                    <img src={file.url} alt={file.name} />
                  ) : (
                    <img src={FILE_ICON_URI} alt={file.name} />
                  )}
                  <span className="nopal-image-chip-label">
                    [{chip.fileIndex}]
                  </span>
                  {isTopOfCollapsedStack && (
                    <span className="nopal-image-chip-stack-badge">
                      +{group.chips.length - 1}
                    </span>
                  )}
                </button>
              );
            });
          })}

          {/* ── Drop zones ─────────────────────────────────────────────────────
           "file" drag  → full-width overlay so the user can drop anywhere
                          in the editor area (covers tray too, which is fine
                          since the user is dragging FROM the tray).
           "chip" drag  → narrow right-edge strip, leaving the tray exposed
                          so chips can still be dragged back to remove them.
      ────────────────────────────────────────────────────────────────────── */}

          {/* FILE DRAG: full-width overlay */}
          {dragType === "file" && (
            <div
              onDragOver={handleDropLineDragOver}
              onDrop={handleDropLineDrop}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 40,
                cursor: "copy",
                background: "rgba(167, 139, 250, 0.06)",
                borderRadius: "4px",
                outline: "2px dashed rgba(167, 139, 250, 0.35)",
                outlineOffset: "-2px",
              }}
            >
              {/* Horizontal snap line */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: dotY,
                  height: 0,
                  borderTop: "2px solid rgba(167, 139, 250, 0.75)",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  transition: "top 0.06s ease",
                }}
              />
              {/* Dot on the snap line */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: dotY,
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "var(--purple-light, #a78bfa)",
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 2px 8px rgba(63,43,70,0.4)",
                  pointerEvents: "none",
                  transition: "top 0.06s ease",
                }}
              />
            </div>
          )}

          {/* CHIP DRAG: original narrow strip (preserves chip→tray removal) */}
          {dragType === "chip" && (
            <>
              {/* Dashed guide from left edge to strip */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 48,
                  top: dotY,
                  height: 0,
                  borderTop: "1.5px dashed rgba(167, 139, 250, 0.5)",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  zIndex: 39,
                }}
              />
              <div
                onDragOver={handleDropLineDragOver}
                onDrop={handleDropLineDrop}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "48px",
                  zIndex: 40,
                  cursor: "move",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: "50%",
                    width: "2px",
                    background: "var(--purple-light, #a78bfa)",
                    transform: "translateX(-50%)",
                    opacity: 0.8,
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: dotY,
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "var(--purple-light, #a78bfa)",
                    transform: "translate(-50%, -50%)",
                    boxShadow: "0 2px 10px rgba(63,43,70,0.45)",
                    pointerEvents: "none",
                    transition: "top 0.08s ease",
                  }}
                />
              </div>
            </>
          )}

          {/* Bottom tray */}
          <div
            className="nopal-tray"
            onDragOver={handleTrayChipDragOver}
            onDrop={handleTrayChipDrop}
          >
            {/* File chips */}
            <div className="nopal-tray-chips">
              {trayFiles.map((file) => (
                <div
                  key={file.index}
                  className={[
                    "nopal-tray-item",
                    file.status === "uploading"
                      ? "nopal-tray-item--uploading"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={file.status === "ready"}
                  onDragStart={
                    file.status === "ready"
                      ? (e) => handleTrayDragStart(e, file.index)
                      : undefined
                  }
                  onDragEnd={handleTrayDragEnd}
                  title={`[${file.index}] ${file.name}`}
                >
                  {file.status === "uploading" ? (
                    <img
                      src={TRAY_LOADING_URI}
                      width={28}
                      height={28}
                      alt="uploading"
                      draggable={false}
                      style={{ display: "block" }}
                    />
                  ) : file.isImage && file.url ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      draggable={false}
                      className="nopal-tray-item-thumb"
                    />
                  ) : (
                    <img
                      src={TRAY_FILE_URI}
                      width={28}
                      height={28}
                      alt={file.name}
                      draggable={false}
                      style={{ display: "block" }}
                    />
                  )}
                  <span className="nopal-tray-item-badge">[{file.index}]</span>
                </div>
              ))}
            </div>

            {/* Unified button group: + | [ ] | actions */}
            <div className="nopal-tray-group">
              {uploadFile && (
                <button
                  className="nopal-tray-add"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach photos or files"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
              <button
                className="nopal-tray-task"
                title="Insert task"
                aria-label="Insert task checkbox"
                onPointerDown={(e) => {
                  e.preventDefault();
                  lexicalEditorRef.current?.dispatchCommand(
                    INSERT_CHECK_LIST_COMMAND,
                    undefined,
                  );
                }}
              >
                [ ]
              </button>
              {actions && <div className="nopal-tray-actions">{actions}</div>}
            </div>

            {/* Hidden file input — kept outside the group so it doesn't
                affect flex layout or border-left sibling counting */}
            {uploadFile && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.h264"
                multiple
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
            )}
          </div>
        </div>
      </RefPopoverContext.Provider>
    </CsvFieldsContext.Provider>
  );
}
