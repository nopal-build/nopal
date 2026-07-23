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
 * covers plain-text PASTE for all of the above, plus anything live-typing
 * doesn't reach at all (container directives, tables, ...) by re-parsing
 * the whole pasted text through the real parser at once.
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
import { TRANSFORMERS } from "@lexical/markdown";
import { OX_CHECK_LIST } from "../oxmarkdown/checklistTransformer";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { OxListItemNode } from "../oxmarkdown/OxListItemNode";
import { CodeNode } from "@lexical/code";
import { $createParagraphNode, $getRoot } from "lexical";
import {
  parseOxDocument,
  serializeOxDocument,
  type DirectiveNode,
} from "../oxmarkdown/document";
import type { OxInteractive } from "../oxmarkdown/interactive";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
import { OxTreeRenderer, DirectiveRegistryContext } from "./OxRenderer";
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
import "../styles/oxmarkdown.css";

// `OX_CHECK_LIST` first — see that file's header for why order matters in
// theory (it doesn't in practice today, since the two regexes trigger at
// disjoint keystroke positions, but listing the more specific one first
// matches the convention `@lexical/markdown`'s own docs imply for transformer
// ordering) — the rest is the library's own default set, unchanged.
const OX_TRANSFORMERS = [OX_CHECK_LIST, ...TRANSFORMERS];

export interface OxEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  mode: "interacting" | "editing";
  directives?: DirectiveRegistry;
  theme?: OxTheme;
  className?: string;
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
      <OxTreeRenderer doc={doc} directives={directives} interactive={interactive} />
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
      ],
      theme: OX_LEXICAL_THEME,
      onError(error: Error) {
        throw error;
      },
    }),
    [],
  );
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  return (
    <div className={`ox-content ox-tokens${className ? ` ${className}` : ""}`} style={style}>
      <DirectiveRegistryContext.Provider value={directives}>
        <LexicalComposer initialConfig={initialConfig}>
          <div style={{ position: "relative" }}>
            <RichTextPlugin
              contentEditable={<ContentEditable className="ox-editing-surface" />}
              placeholder={
                <div className="ox-editing-placeholder">Start typing — try “/” for commands…</div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <HistoryPlugin />
          <ListPlugin />
          <OxChecklistPlugin />
          <LinkPlugin />
          <TabIndentationPlugin />
          <HorizontalRulePlugin />
          <MarkdownShortcutPlugin transformers={OX_TRANSFORMERS} />
          <MarkdownSyncPlugin markdown={markdown} onChange={onChange} />
          <InteractablesPlugin />
          <SlashCommandPlugin />
          <DirectiveShortcutPlugin />
          <MarkdownPastePlugin />
          <ChecklistUpgradePlugin />
        </LexicalComposer>
      </DirectiveRegistryContext.Provider>
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
