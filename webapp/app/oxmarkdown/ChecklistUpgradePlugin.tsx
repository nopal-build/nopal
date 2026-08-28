/**
 * Closes the one real gap `checklistTransformer.ts`'s `OX_CHECK_LIST`
 * documents but doesn't solve: typing the FULL `- [ ] ` sequence
 * character-by-character. `registerMarkdownShortcuts`'s `ElementTransformer`
 * mechanism only ever fires for a fresh, top-level paragraph (confirmed
 * directly reading `LexicalMarkdown.dev.mjs`: `runElementTransformers`
 * requires the anchor's grandparent to be root) — so typing `- ` converts
 * to a PLAIN bullet (matching `UNORDERED_LIST`'s regex) immediately, before
 * `[ ] ` is ever typed; by the time `[ ] ` lands, the text is now INSIDE a
 * list item, where `ElementTransformer`s structurally can't reach at all.
 *
 * This plugin picks up exactly where that leaves off: it watches text
 * typed at the very START of an existing PLAIN (non-checkbox) list item —
 * regardless of how that item was created (typed `- `, continued via
 * Enter, produced by the slash-command menu, ...) — and the moment it
 * matches `[ ] `/`[x] `, strips those literal characters and flips the
 * SAME item (same list, same position) into a real checkbox via its own
 * `checked` field, exactly as if it had been typed that way from the
 * start. `- [ ] ` therefore now visibly becomes a checkbox in two quick,
 * sequential steps (bullet, then checkbox) rather than one atomic one —
 * a real, minor difference from `- ` never having existed as a bullet at
 * all, but invisible in practice at normal typing speed, and irrelevant to
 * the exported markdown either way.
 *
 * Deliberately its own `registerUpdateListener`, not folded into
 * `checklistTransformer.ts`'s `ElementTransformer` — that mechanism is
 * structurally the wrong shape for this (it never sees text inside an
 * existing list item at all). Mirrors `registerMarkdownShortcuts`'s own
 * internal gating conditions closely (read directly from its source) so
 * this feels like the same class of live shortcut, not a special case:
 * only fires for genuine, single-keystroke typing (an `anchorOffset` jump
 * of more than 1 — e.g. paste, or `$insertNodes` — is deliberately
 * ignored), never during composition/undo/redo/collaboration.
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
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestOxListItemNode } from "./OxListItemNode";

// No leading dash/whitespace group here (unlike `CHECK_LIST.regExp`) — by
// the time this runs, the dash has already become real list structure;
// this only ever matches against a list ITEM's own leading text.
const CHECKBOX_PREFIX_REGEX = /^\[(\s|x)?\]\s/i;

export default function ChecklistUpgradePlugin(): null {
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
      // Only ordinary, single-character typing — a bigger jump (paste,
      // `$insertNodes`, ...) is handled by its own real mechanism already.
      if (anchorOffset !== 1 && anchorOffset > prevSelection.anchor.offset + 1) return;

      const text = editorState.read(() => {
        const node = $getNodeByKey(anchorKey);
        return $isTextNode(node) ? node.getTextContent() : null;
      });
      if (text === null) return;

      const match = text.match(CHECKBOX_PREFIX_REGEX);
      // `match[0].length === anchorOffset`: the trigger is the SPACE just
      // typed, landing exactly at the end of the matched prefix — the same
      // check `runElementTransformers` uses for its own trigger.
      if (!match || match[0].length !== anchorOffset) return;

      editor.update(() => {
        const liveTextNode = $getNodeByKey(anchorKey);
        if (!$isTextNode(liveTextNode)) return;
        const listItem = $getNearestOxListItemNode(liveTextNode);
        if (!listItem) return;
        // Only upgrade a genuinely PLAIN item, and only when this text
        // node is the item's very FIRST content — same guarantee
        // `runElementTransformers` requires of its own anchor (`[ ] ` must
        // be the start of the item, not text typed mid-formatting-run).
        if (listItem.getChecked() !== undefined) return;
        if (listItem.getFirstChild() !== liveTextNode) return;

        const checked = (match[1] ?? "").toLowerCase() === "x";
        liveTextNode.setTextContent(text.slice(match[0].length));
        listItem.setChecked(checked);
        liveTextNode.select(0, 0);
      });
    });
  }, [editor]);

  return null;
}
