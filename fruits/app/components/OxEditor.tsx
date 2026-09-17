/**
 * OxEditor — the Interacting-mode AND Editing-mode surface for an
 * OxMarkdown document, per the `oxmarkdown` skill's "Naming" section (one
 * component covering both modes via `mode`, replacing the old three
 * separate MdxEditorClient/Workable/Editable components).
 *
 * `mode="interacting"` (build plan step 2, done first): owns selection +
 * mutates the exact tree `OxTreeRenderer` renders, entirely hand-rolled,
 * zero Lexical — see `oxmarkdown/interactive.ts` for why.
 *
 * `mode="editing"` (build plan step 4): a trimmed Lexical config — see the
 * `oxmarkdown` skill's TODO 1 for why Lexical, and why trimmed (no
 * CodeMirror/Sandpack/Radix/table-plugin bloat, just rich-text + list +
 * link + code + our own nodes). Reuses the SAME document model as step 1 —
 * `oxmarkdown/editingTransforms.ts` converts real mdast to/from real
 * Lexical nodes; it never uses `@lexical/markdown`'s own parser as the
 * source of truth (see that file's header for why that distinction
 * matters). `@lexical/markdown`'s `TRANSFORMERS` ARE used, but only for
 * their live "typing `**x**` formats it as bold" convenience — that only
 * ever touches Lexical's own node tree, which `editingTransforms.ts` has
 * to handle regardless of how a node was produced. `OX_TRANSFORMERS`
 * extends that default set with our own `OX_CHECK_LIST`
 * (`oxmarkdown/checklistTransformer.ts`) so typing `[ ] `/`[x] ` live-
 * converts into a real checkbox the same way `**bold**` or `# ` do.
 * `DirectiveShortcutPlugin` (Enter-triggered, not an `ElementTransformer` —
 * see its own header for why) covers the same live-conversion idea for our
 * `::name{attrs}` directive syntax. `ChecklistUpgradePlugin` closes the one
 * gap `OX_CHECK_LIST` can't reach on its own: typing `- [ ] ` (WITH the
 * dash) character-by-character converts to a plain bullet after `- ` before
 * `[ ] ` is ever typed (see that file's header) — this plugin watches an
 * existing plain list item's own leading text and upgrades it into a real
 * checkbox in place the moment `[ ] `/`[x] ` appears there. `MarkdownPastePlugin`
 * covers ALL paste — plain-text AND rich/HTML alike, always stripped down
 * to plain text first (paste never carries a source's own formatting in) —
 * for all of the above, plus anything live-typing doesn't reach at all
 * (container directives, tables, ...) by re-parsing the whole pasted text
 * through the real parser at once.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { QUOTE, TRANSFORMERS } from "@lexical/markdown";
import { OX_CHECK_LIST } from "../oxmarkdown/checklistTransformer";
import { OX_QUOTE } from "../oxmarkdown/quoteTransformer";
import { OX_TOGGLE } from "../oxmarkdown/toggleTransformer";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { OxListItemNode } from "../oxmarkdown/OxListItemNode";
import { CodeNode } from "@lexical/code";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import {
  parseOxDocument,
  serializeOxDocument,
  type DirectiveNode,
} from "oxmarkdown-core";
import type { OxInteractive } from "../oxmarkdown/interactive";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
import {
  OxTreeRenderer,
  DirectiveRegistryContext,
  CardResolverContext,
  UploadFileContext,
} from "./OxRenderer";
import { OxDirectiveNode, OxOpaqueNode } from "../oxmarkdown/editingNodes";
import {
  exportOxDocument,
  importOxDocument,
  type AsideContent,
} from "../oxmarkdown/editingTransforms";
import OxChecklistPlugin from "../oxmarkdown/OxChecklistPlugin";
import InteractablesPlugin from "../oxmarkdown/InteractablesPlugin";
import SlashCommandPlugin from "../oxmarkdown/SlashCommandPlugin";
import DirectiveShortcutPlugin from "../oxmarkdown/DirectiveShortcutPlugin";
import MarkdownPastePlugin from "../oxmarkdown/MarkdownPastePlugin";
import ChecklistUpgradePlugin from "../oxmarkdown/ChecklistUpgradePlugin";
import ToggleListPlugin from "../oxmarkdown/ToggleListPlugin";
import MentionPlugin from "../oxmarkdown/MentionPlugin";
import type { MentionItem, MentionSearch } from "oxmarkdown-core";
import CrossEditorArrowPlugin from "../oxmarkdown/CrossEditorArrowPlugin";
import MinRowsPlugin, { DEFAULT_MIN_EDITOR_ROWS, normalizeMinRows } from "../oxmarkdown/MinRowsPlugin";
import LeadingBlockGuardPlugin from "../oxmarkdown/LeadingBlockGuardPlugin";
import OxTogglePlugin from "../oxmarkdown/OxTogglePlugin";
import { OxToggleNode, OxToggleSummaryNode } from "../oxmarkdown/OxToggleNode";
import FileDirectiveArrowPlugin from "../oxmarkdown/FileDirectiveArrowPlugin";
import NestedEditorBlurPlugin from "../oxmarkdown/NestedEditorBlurPlugin";
import AddFileLinkPlugin from "../oxmarkdown/AddFileLinkPlugin";
import FileCaptionArrowPlugin from "../oxmarkdown/FileCaptionArrowPlugin";
import CardDirectiveArrowPlugin from "../oxmarkdown/CardDirectiveArrowPlugin";
import CardEditorArrowPlugin from "../oxmarkdown/CardEditorArrowPlugin";
import type { UploadFileFn } from "../oxmarkdown/fileDirective";
import type { CardResolver, GalleryFolderResolver } from "oxmarkdown-core";
import { OxEditorContext } from "../oxmarkdown/OxEditorContext";
import "../styles/oxmarkdown.css";

// `OX_CHECK_LIST`/`OX_QUOTE`/`OX_TOGGLE` first — see that file's header for
// why order matters in theory (it doesn't in practice today, since the
// regexes trigger at disjoint keystroke positions, but listing the more
// specific ones first matches the convention `@lexical/markdown`'s own
// docs imply for transformer ordering). The default `QUOTE` (keyed on
// `> `) is filtered OUT of the library's own default set — `> ` now
// triggers a Toggle List instead (`OX_TOGGLE`); blockquotes moved to `"`
// (`OX_QUOTE`) — see both transformers' own headers.
const OX_TRANSFORMERS = [
  OX_CHECK_LIST,
  OX_QUOTE,
  OX_TOGGLE,
  ...TRANSFORMERS.filter((t) => t !== QUOTE),
];

export interface OxEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  mode: "interacting" | "editing";
  directives?: DirectiveRegistry;
  theme?: OxTheme;
  className?: string;
  /** Enables `@` mentions in Editing mode — see `oxmarkdown/mention.ts`.
   * Ignored in Interacting mode (no typing happens there, nothing to
   * trigger). Omit entirely to leave `@` as plain, inert text. */
  mentionSearch?: MentionSearch;
  /** Fires when a mention search result is actually selected — see
   * `oxmarkdown/mention.ts`'s header for what this is for (recording
   * recency, performing a deferred "create"). Ignored if `mentionSearch`
   * isn't also supplied. */
  onMentionSelect?: (item: MentionItem) => void;
  /** Opts into cross-editor ArrowUp/ArrowDown navigation — see
   * `oxmarkdown/OxEditorGroup.tsx`. Requires an ancestor `<OxEditorGroup>`
   * and a stable id for this editor, unique within that group's `order`.
   * Ignored in Interacting mode (no roaming caret there to move). */
  groupId?: string;
  /** Enables the `::file{...}` interactable's `/files` slash command (see
   * `oxmarkdown/fileDirective.ts`) — e.g. on for both the daily prose AND
   * cards, off for a file's OWN nested caption editor (so captions can't
   * recursively offer file attachments inside a file's caption). Ignored
   * in Interacting mode (inserting new content is Editing-only). */
  allowFileAttachments?: boolean;
  /** ADDITIONALLY shows the persistent "add file" link below the editor
   * (a second trigger for the exact same action `/files` runs — see
   * `oxmarkdown/AddFileLinkPlugin.tsx`). Only meaningful alongside
   * `allowFileAttachments`; on for cards, off for plain prose (which
   * still gets `/files`, just not the persistent link). */
  showAddFileLink?: boolean;
  /** Uploads a picked file to real storage before it's attached — see
   * `oxmarkdown/fileDirective.ts`'s `UploadFileFn`. Threaded through to
   * both the `/files` slash command and the persistent "add file" link.
   * `OxEditor` itself stays ignorant of vault/folder specifics; the
   * caller (e.g. the Daily Log route) owns where bytes actually go. Omit
   * for a browser-only preview with no server persistence. */
  onUploadFile?: UploadFileFn;
  /** Resolves a `::card{file="..."}` directive's `file` attribute to real
   * project/content data — see `oxmarkdown/cardDirective.ts`'s
   * `CardResolver`. `OxEditor` itself stays ignorant of vault/project
   * specifics, same spirit as `onUploadFile`/`mentionSearch`. Omit to
   * leave any `::card{...}` directive showing a plain "Loading card…"
   * placeholder (e.g. a caption or other nested editor that never needs
   * to resolve cards itself). */
  resolveCard?: CardResolver;
  /** Resolves a `::gallery{folder="..."}` LEAF directive's `folder`
   * attribute to that folder's images — see
   * `oxmarkdown-core/galleryDirective.ts`. STATIC/Interacting-mode only,
   * same as the directive itself — ignored in Editing mode. */
  resolveGalleryFolder?: GalleryFolderResolver;
  /** How many rows tall this editor's minimum clickable canvas is — see
   * `oxmarkdown/MinRowsPlugin.tsx`. Defaults to a full 4-row canvas (a
   * card/prose editor); a `::file{...}` directive's caption editor passes
   * `1` instead, so it starts small and simply grows with its own
   * content. Anything below `0` is treated as `1`. */
  minRows?: number;
  /** Internal use only, set by `editingNodes.tsx` when mounting a
   * `::file{...}` directive's caption editor — lets ArrowUp/ArrowDown flow
   * into a sibling file directive's caption within the SAME outer
   * document (see `oxmarkdown/fileCaptionFlow.ts`). Not meant to be
   * passed by ordinary callers. */
  fileCaptionFlow?: { outerEditor: LexicalEditor; nodeKey: string };
  /** Internal use only, set by `editingNodes.tsx` when mounting a
   * `::card{...}` directive's own nested editor — lets ArrowUp/ArrowDown
   * flow INTO the card from the surrounding outer document (see
   * `oxmarkdown/cardFlow.ts`). Not meant to be passed by ordinary
   * callers. */
  cardFlow?: { outerEditor: LexicalEditor; nodeKey: string };
  /** Editing-mode empty-state placeholder text. Defaults to the usual
   * "Start typing…" hint; a `::file{...}` directive's caption editor
   * passes `"image info"` instead — a short annotation field reads
   * better with a hint about WHAT goes there than a generic typing
   * prompt. */
  placeholder?: string;
}

export default function OxEditor(props: OxEditorProps) {
  if (props.mode === "editing") return <OxEditingSurface {...props} />;
  return <OxInteractingSurface {...props} />;
}

// ── Interacting mode ─────────────────────────────────────────────────────

function OxInteractingSurface({
  markdown,
  onChange,
  directives,
  theme,
  className,
  resolveCard,
  resolveGalleryFolder,
}: OxEditorProps) {
  const doc = useMemo(() => parseOxDocument(markdown), [markdown]);
  const [selected, setSelected] = useState<object | null>(null);
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  /** Every mutation follows the same shape: change the tree this render
   * already parsed, serialize THAT tree (not a fresh parse), hand the new
   * text to the caller, and clear selection — the next render will parse
   * the caller's updated markdown into an entirely new tree, so the old
   * selected reference can't mean anything there. */
  function commit() {
    onChange(serializeOxDocument(doc));
    setSelected(null);
  }

  const interactive: OxInteractive = {
    isSelected: (node) => node === selected,
    select: setSelected,
    toggleTask(node) {
      node.checked = !node.checked;
      commit();
    },
    editDirectiveAttr(node: DirectiveNode, key, value) {
      node.attributes = { ...node.attributes, [key]: value };
      commit();
    },
  };

  return (
    <div className={`ox-content ox-tokens${className ? ` ${className}` : ""}`} style={style}>
      <div className="ox-dot-grid">
      {/* Interacting mode ALSO provides both contexts (not just Editing
          mode) — a `::card{...}` directive rendered here (`CardDirectiveStatic`
          in `OxRenderer.tsx`) may need to mount a REAL nested
          `<OxEditor mode="interacting">` for its own content, and reaches
          the component via `OxEditorContext` for the same "avoid a
          circular import" reason `editingNodes.tsx` does. */}
      <DirectiveRegistryContext.Provider value={directives}>
        <CardResolverContext.Provider value={resolveCard}>
          <OxEditorContext.Provider value={OxEditor}>
            <OxTreeRenderer
              doc={doc}
              directives={directives}
              interactive={interactive}
              resolveCard={resolveCard}
              resolveGalleryFolder={resolveGalleryFolder}
            />
          </OxEditorContext.Provider>
        </CardResolverContext.Provider>
        </DirectiveRegistryContext.Provider>
      </div>
    </div>
  );
}

// ── Editing mode ─────────────────────────────────────────────────────────

/** Maps `@lexical/list`'s checklist classes onto the editing-mode CSS in
 * `oxmarkdown.css` — see that file's "Editing mode: checklist" section for
 * why these are visually-matched, not literally the same DOM shape as
 * Interacting mode's static `.ox-task-checkbox`. Both checked/unchecked
 * also carry `ox-task-item` so the plain bullet-marker rule's
 * `:not(.ox-task-item)` exclusion still skips checklist items. */
const OX_LEXICAL_THEME = {
  code: "ox-code-block-editing",
  list: {
    listitemChecked: "ox-task-item ox-task-item-editing--checked",
    listitemUnchecked: "ox-task-item ox-task-item-editing--unchecked",
  },
};

function OxEditingSurface({
  markdown,
  onChange,
  directives,
  theme,
  className,
  mentionSearch,
  onMentionSelect,
  groupId,
  allowFileAttachments,
  showAddFileLink,
  onUploadFile,
  resolveCard,
  minRows,
  fileCaptionFlow,
  cardFlow,
  placeholder = "Start typing — try “/” for commands…",
}: OxEditorProps) {
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "OxEditor",
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        OxListItemNode,
        {
          replace: ListItemNode,
          // `node.getChecked()` is the wrong thing to read here — it's
          // gated on the PARENT list's type (see `OxListItemNode.ts`'s
          // header), and a node passed into this callback is freshly
          // constructed, not yet attached to any parent. `__checked`/
          // `__value` are the real underlying fields (confirmed accessible
          // — declared as plain, not JS-private, class fields).
          with: (node: ListItemNode) => new OxListItemNode(node.__value, node.__checked),
          withKlass: OxListItemNode,
        },
        LinkNode,
        CodeNode,
        HorizontalRuleNode,
        OxDirectiveNode,
        OxOpaqueNode,
        OxToggleNode,
        OxToggleSummaryNode,
      ],
      theme: OX_LEXICAL_THEME,
      onError(error: Error) {
        throw error;
      },
    }),
    [],
  );
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;
  // Same clamping `MinRowsPlugin` itself uses for the REAL padded-row
  // count — shared via `normalizeMinRows` so the visual `min-height`
  // (`--ox-min-rows`, `oxmarkdown.css`) can't drift from actual behavior.
  const cssMinRows = normalizeMinRows(minRows ?? DEFAULT_MIN_EDITOR_ROWS);

  return (
    <div className={`ox-content ox-tokens${className ? ` ${className}` : ""}`} style={style}>
      <div className="ox-dot-grid">
        <DirectiveRegistryContext.Provider value={directives}>
          {/* Provides itself (`OxEditor`, this module's own default export) so
              `editingNodes.tsx` can mount a nested `<OxEditor>` for a
              `::file{...}` directive's caption, or a `::card{...}`
              directive's own content, without a circular import — see
              `oxmarkdown/OxEditorContext.tsx`. */}
          <CardResolverContext.Provider value={resolveCard}>
          <UploadFileContext.Provider value={onUploadFile}>
          <OxEditorContext.Provider value={OxEditor}>
            <LexicalComposer initialConfig={initialConfig}>
              <div
                style={
                  {
                    position: "relative",
                    "--ox-min-rows": cssMinRows,
                  } as CSSProperties
                }
              >
                <RichTextPlugin
                  contentEditable={<ContentEditable className="ox-editing-surface" />}
                  placeholder={<div className="ox-editing-placeholder">{placeholder}</div>}
                  ErrorBoundary={LexicalErrorBoundary}
                />
              </div>
              <HistoryPlugin />
              <ListPlugin />
              <OxChecklistPlugin />
              <OxTogglePlugin />
              <LinkPlugin />
              <TabIndentationPlugin />
              <HorizontalRulePlugin />
              <MarkdownShortcutPlugin transformers={OX_TRANSFORMERS} />
              <MarkdownSyncPlugin markdown={markdown} onChange={onChange} />
              <InteractablesPlugin />
              <NestedEditorBlurPlugin />
              <FileDirectiveArrowPlugin />
              <CardDirectiveArrowPlugin />
              <SlashCommandPlugin
                allowFileAttachments={allowFileAttachments}
                onUploadFile={onUploadFile}
              />
              <DirectiveShortcutPlugin />
              <MarkdownPastePlugin />
              <ChecklistUpgradePlugin />
              <ToggleListPlugin />
              {mentionSearch && (
                <MentionPlugin search={mentionSearch} onSelect={onMentionSelect} />
              )}
              {groupId && <CrossEditorArrowPlugin groupId={groupId} />}
              {fileCaptionFlow && (
                <FileCaptionArrowPlugin
                  outerEditor={fileCaptionFlow.outerEditor}
                  nodeKey={fileCaptionFlow.nodeKey}
                />
              )}
              {cardFlow && (
                <CardEditorArrowPlugin
                  outerEditor={cardFlow.outerEditor}
                  nodeKey={cardFlow.nodeKey}
                />
              )}
              <MinRowsPlugin minRows={minRows} />
              <LeadingBlockGuardPlugin />
              {allowFileAttachments && showAddFileLink && (
                <AddFileLinkPlugin onUploadFile={onUploadFile} />
              )}
            </LexicalComposer>
          </OxEditorContext.Provider>
          </UploadFileContext.Provider>
          </CardResolverContext.Provider>
        </DirectiveRegistryContext.Provider>
      </div>
    </div>
  );
}

/** Bridges the controlled `markdown` string prop to/from Lexical's internal
 * node tree, via `oxmarkdown/editingTransforms.ts` (real mdast, not
 * `@lexical/markdown`'s parser — see this file's header). Seeds on mount
 * and whenever `markdown` changes from OUTSIDE this component; skips
 * re-seeding when the change is this component's OWN `onChange` echoing
 * back in (a controlled-input pattern — re-seeding on every keystroke would
 * blow away Lexical's live selection on each character typed). */
function MarkdownSyncPlugin({
  markdown,
  onChange,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const asideRef = useRef<AsideContent>({ frontmatter: null, definitions: [] });
  const lastEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (markdown === lastEmittedRef.current) return;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const doc = parseOxDocument(markdown);
      const { lexicalNodes, aside } = importOxDocument(doc);
      asideRef.current = aside;
      root.append(...(lexicalNodes.length > 0 ? lexicalNodes : [$createParagraphNode()]));
    });
    // Only re-seed in response to the `markdown` PROP actually changing
    // (including the very first mount) — `editor` is stable for the
    // component's lifetime, so it's safe to omit without masking a real
    // dependency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      // Lexical's update listener also fires for pure selection changes —
      // only re-serialize (and notify the caller) when content actually
      // changed.
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      editorState.read(() => {
        const { doc, join } = exportOxDocument($getRoot(), asideRef.current);
        const next = serializeOxDocument(doc, join);
        lastEmittedRef.current = next;
        onChange(next);
      });
    });
  }, [editor, onChange]);

  return null;
}
