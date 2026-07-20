/**
 * Live-typing shortcut for LEAF directives: typing `::name{attrs}` alone on
 * an otherwise-empty top-level line, then pressing Enter, converts it into
 * a real `OxDirectiveNode` — the same live-conversion idea as `**bold**` or
 * `- [ ] `, extended to our own generic-directive syntax per the user's
 * explicit request ("this also goes for the remark syntax").
 *
 * NOT built as an `ElementTransformer` (unlike `checklistTransformer.ts`) —
 * deliberately, not for lack of trying. That mechanism only ever fires
 * immediately after typing a SPACE (confirmed directly by reading
 * `registerMarkdownShortcuts`'s update listener in
 * `LexicalMarkdown.dev.mjs`: `textContent[anchorOffset - 1] !== ' '` bails
 * out otherwise) — fine for `- [ ] ` and `# `, which always end with a
 * natural trailing space before more text follows, but a directive's
 * closing `}` has no such natural trailing space; the natural finishing
 * gesture is Enter. So this is a dedicated `KEY_ENTER_COMMAND` handler
 * instead, at `COMMAND_PRIORITY_HIGH` (above the default Enter handling,
 * same priority `SlashCommandPlugin` uses for its own Enter interception).
 *
 * Scope, deliberately narrow for this pass (see the oxmarkdown skill's Open
 * TODOs, "`@`-embed syntax" section and the live-typing/paste build-plan
 * entry for the full reasoning):
 *   - LEAF directives only (`::name{attrs}`, exactly two colons) — a
 *     container directive (`:::name{attrs} ... :::`) is structurally
 *     multi-line and doesn't fit a single-Enter conversion; pasting one
 *     works today via `MarkdownPastePlugin`, which re-parses the whole
 *     pasted text through the real multi-line-capable parser.
 *   - A single, whole top-level line — the paragraph's ONLY content must be
 *     the directive text, matching the leaf-directive convention ("block,
 *     own line, no children" per the skill's syntax table). Typing a
 *     directive mid-sentence is the text-directive (`:name{attrs}`) form,
 *     not handled by this plugin — deferred, same as container directives;
 *     paste covers it.
 *   - A cheap regex decides CANDIDACY only (whether it's worth attempting a
 *     real parse at all) — the REAL parser (`parseOxDocument`, the same
 *     `mdast-util-directive`-backed one used everywhere else in this
 *     codebase) decides validity, never a hand-rolled attribute parser. If
 *     the real parser doesn't actually produce a single `leafDirective`
 *     (malformed attrs, an unbalanced brace, ...) this returns `false` and
 *     Enter behaves exactly as if this plugin didn't exist.
 */

import { useEffect } from "react";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { isDirectiveNode, parseOxDocument } from "./document";
import { $createOxDirectiveNode } from "./editingNodes";

// Loose candidacy check only, per this file's header — two colons, a name,
// an optional `{...}` attrs block, and NOTHING else on the line.
const LEAF_DIRECTIVE_CANDIDATE = /^::[A-Za-z][\w-]*(\{.*\})?$/;

export default function DirectiveShortcutPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchor = selection.anchor;
        if (anchor.type !== "text") return false;

        const textNode = anchor.getNode();
        // Only at the END of the text — Enter mid-line splits the block
        // rather than "finishing" it, and a directive line has nothing
        // meaningful to split.
        if (anchor.offset !== textNode.getTextContentSize()) return false;

        const paragraph = textNode.getParent();
        if (!paragraph) return false;
        // The directive must be the paragraph's ENTIRE content — a leaf
        // directive is the whole line, per the skill's syntax table.
        if (paragraph.getChildrenSize() !== 1) return false;
        const grandparent = paragraph.getParent();
        if (!grandparent || !$isRootOrShadowRoot(grandparent)) return false;

        const text = textNode.getTextContent();
        if (!LEAF_DIRECTIVE_CANDIDATE.test(text)) return false;

        const parsed = parseOxDocument(text);
        if (parsed.children.length !== 1) return false;
        const [node] = parsed.children;
        if (!isDirectiveNode(node) || node.type !== "leafDirective") return false;

        event?.preventDefault();
        const directive = $createOxDirectiveNode(node);
        paragraph.replace(directive);
        // A decorator can't itself hold a text caret — add a fresh
        // paragraph right after and select it, so typing continues
        // naturally below the new directive (same pattern
        // `SlashCommandPlugin.tsx`'s `runOnBlock` uses).
        const following = $createParagraphNode();
        directive.insertAfter(following);
        following.select();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
