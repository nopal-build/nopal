/**
 * Mounted inside a `::card{...}` directive's OWN nested editor — makes it
 * feel like a fully integrated part of the outer document, matching
 * `FileCaptionArrowPlugin.tsx`'s job for a file's caption (minus the
 * sibling-to-sibling flow and double-Enter escape gesture — see
 * `cardFlow.ts`'s header for why those specifically aren't built yet):
 *
 * - Registers this card into `cardFlow.ts`'s registry (scoped to the
 *   OUTER editor this card lives in) so `CardDirectiveArrowPlugin.tsx`
 *   (mounted on the OUTER editor) can find and focus it when
 *   ArrowDown/ArrowUp approaches the card from the surrounding document.
 * - ArrowDown/ArrowUp at THIS editor's own true end/start (never when
 *   there's more to navigate within the card first — a line below in the
 *   same paragraph, the next list item, ...) flows into the nearest real
 *   content in the OUTER editor right after/before the card, creating a
 *   blank line to land in if there's nothing there yet.
 *
 * Whenever this hands focus OFF to the outer editor, THIS editor's own
 * recorded selection is explicitly cleared first (`$setSelection(null)`)
 * — the SAME real pitfall `FileDirectiveArrowPlugin.tsx`'s header
 * documents in full (confirmed there by direct testing, not re-derived
 * here): the side handing focus away must clear its own selection or the
 * next keystroke typed on the other side bounces back.
 */

import { useEffect } from "react";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { isAtDocumentEnd, isAtDocumentStart } from "./CrossEditorArrowPlugin";
import { focusOuterEditorAcrossCardBoundary, registerCardEditor } from "./cardFlow";
import type { OxEditorGroupMember } from "./OxEditorGroup";

export default function CardEditorArrowPlugin({
  outerEditor,
  nodeKey,
}: {
  outerEditor: LexicalEditor;
  nodeKey: string;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const member: OxEditorGroupMember = {
      focusStart: () => editor.update(() => $getRoot().selectStart()),
      focusEnd: () => editor.update(() => $getRoot().selectEnd()),
    };
    const unregister = registerCardEditor(outerEditor, nodeKey, member);

    function handleArrow(direction: 1 | -1) {
      return (event: KeyboardEvent): boolean => {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const atBoundary =
          direction === 1 ? isAtDocumentEnd(selection) : isAtDocumentStart(selection);
        if (!atBoundary) return false;

        $setSelection(null); // see this file's header
        const moved = focusOuterEditorAcrossCardBoundary(outerEditor, nodeKey, direction);
        if (!moved) return false;

        event.preventDefault();
        return true;
      };
    }

    const unregisterDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      handleArrow(1),
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      handleArrow(-1),
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregister();
      unregisterDown();
      unregisterUp();
    };
  }, [editor, outerEditor, nodeKey]);

  return null;
}
