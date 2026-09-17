/**
 * Live-typing list conversion for Toggle List BODIES specifically: typing
 * `- `/`* `/`+ ` or `1. ` at the start of a toggle's own body paragraph
 * converts it into a real bullet/ordered list — the same conversion
 * `@lexical/markdown`'s own `UNORDERED_LIST`/`ORDERED_LIST` transformers
 * already do everywhere else, just reachable from inside a toggle too.
 *
 * Needed because `registerMarkdownShortcuts`'s `ElementTransformer`
 * dispatch REQUIRES the paragraph's own PARENT to be the root (or a
 * shadow root) — confirmed directly reading `runElementTransformers`'s
 * source, the SAME restriction `checklistTransformer.ts`'s own header
 * documents for checkboxes. A toggle body paragraph's parent is the
 * `OxToggleNode`, never root, so `- `/`1. ` typed there never reached ANY
 * `ElementTransformer` at all — list or otherwise, release-note bullets
 * included.
 *
 * Modeled directly on `ChecklistUpgradePlugin.tsx`'s own workaround for
 * the analogous problem: a plain `registerUpdateListener` matching
 * single-keystroke typing against the SAME regexes `@lexical/markdown`
 * exports (`UNORDERED_LIST.regExp`/`ORDERED_LIST.regExp` — reused
 * directly, not hand-copied) and performing the same conversion
 * `listReplace()` does, by hand, entirely outside
 * `MarkdownShortcutPlugin`'s constrained dispatch. Uses `OxListItemNode`
 * (not `@lexical/list`'s plain `ListItemNode`) — required, not a style
 * preference: `editingTransforms.ts`'s export path only recognizes
 * `OxListItemNode` children when serializing a list
 * (`.filter($isOxListItemNode)`), so a plain `ListItemNode` here would be
 * silently DROPPED on save.
 *
 * Scoped specifically to a toggle's own body (not generalized to "any
 * non-root paragraph," e.g. blockquotes) — that's the concrete, requested
 * gap; broadening further can follow if a real need shows up.
 */

import { useEffect } from "react";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  HISTORIC_TAG,
  PASTE_TAG,
  type ParagraphNode,
} from "lexical";
import { ORDERED_LIST, UNORDERED_LIST } from "@lexical/markdown";
import { $createListNode, $isListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createOxListItemNode } from "./OxListItemNode";
import { $isOxToggleNode } from "./OxToggleNode";

export default function ToggleListPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
      if (tags.has(COLLABORATION_TAG) || tags.has(HISTORIC_TAG) || tags.has(PASTE_TAG)) return;
      if (editor.isComposing()) return;

      const selection = editorState.read(() => $getSelection());
      const prevSelection = prevEditorState.read(() => $getSelection());
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      if (!$isRangeSelection(prevSelection) || selection.is(prevSelection)) return;

      const anchorKey = selection.anchor.key;
      const anchorOffset = selection.anchor.offset;
      if (!dirtyLeaves.has(anchorKey)) return;
      // Only ordinary, single-character typing — matches the same guard
      // `ChecklistUpgradePlugin.tsx` uses for the analogous problem.
      if (anchorOffset !== 1 && anchorOffset > prevSelection.anchor.offset + 1) return;

      const text = editorState.read(() => {
        const node = $getNodeByKey(anchorKey);
        return $isTextNode(node) ? node.getTextContent() : null;
      });
      if (text === null) return;

      const unorderedMatch = text.match(UNORDERED_LIST.regExp);
      const orderedMatch = text.match(ORDERED_LIST.regExp);
      const match = unorderedMatch ?? orderedMatch;
      if (!match || match[0].length !== anchorOffset) return;
      const ordered = match === orderedMatch;

      editor.update(() => {
        const liveTextNode = $getNodeByKey(anchorKey);
        if (!$isTextNode(liveTextNode)) return;

        const paragraph = liveTextNode.getParent();
        if (!paragraph || paragraph.getType() !== "paragraph") return;
        // Only inside a toggle's own body, and only when this text node is
        // the paragraph's very FIRST content — the same guarantee
        // `runElementTransformers` requires of its own anchor.
        if (!$isOxToggleNode(paragraph.getParent())) return;
        if (paragraph.getFirstChild() !== liveTextNode) return;

        const listType: "bullet" | "number" = ordered ? "number" : "bullet";
        const previousNode = paragraph.getPreviousSibling();
        const nextNode = paragraph.getNextSibling();
        const listItem = $createOxListItemNode(undefined);

        liveTextNode.setTextContent(text.slice(match[0].length));

        if ($isListNode(nextNode) && nextNode.getListType() === listType) {
          const firstChild = nextNode.getFirstChild();
          if (firstChild) firstChild.insertBefore(listItem);
          else nextNode.append(listItem);
        } else if ($isListNode(previousNode) && previousNode.getListType() === listType) {
          previousNode.append(listItem);
        } else {
          const list = $createListNode(listType, ordered ? Number(match[2]) : 1);
          (paragraph as ParagraphNode).insertBefore(list);
          list.append(listItem);
        }
        listItem.append(...paragraph.getChildren());
        paragraph.remove();
        listItem.select(0, 0);
      });
    });
  }, [editor]);

  return null;
}
