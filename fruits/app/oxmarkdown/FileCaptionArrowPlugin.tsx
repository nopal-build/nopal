/**
 * Mounted inside a `::file{...}` directive's caption editor (see
 * `editingNodes.tsx`) — registers this caption into `fileCaptionFlow.ts`'s
 * registry (scoped to the OUTER editor this file directive lives in) and
 * makes the caption feel like a fluid, integrated part of the outer
 * document rather than a separate little box floating next to it:
 *
 * - ArrowDown/ArrowUp at the caption's own true start/end flow into a
 *   sibling file directive's caption if one is immediately adjacent, or
 *   otherwise into the nearest real content in the OUTER editor right
 *   before/after the file directive — creating a blank line to land in
 *   if there's nothing there yet. See `fileCaptionFlow.ts`'s header for
 *   the full reasoning and the one deliberately unhandled edge case.
 * - Enter on an already-empty caption line "escapes" to the outer editor
 *   instead of padding the caption with yet another blank row — hitting
 *   Enter twice (once to end the current line, once more on the now-
 *   empty line) reads as "I'm done with this caption," so it lands the
 *   caret in the outer document right after the image, same as
 *   ArrowDown falling through past the caption's last line.
 *
 * Whenever either of these hands focus OFF to the outer editor, THIS
 * editor's own recorded selection is explicitly cleared first
 * (`$setSelection(null)`) — confirmed necessary by direct testing, not
 * just theorized: leaving a stale selection behind causes the FIRST
 * keystroke typed in the outer editor afterward to bounce focus straight
 * back into this caption. Root cause: this caption's own onChange (fired
 * by literally any edit anywhere in the outer document that also
 * happens to touch this same file directive's attributes, or more
 * subtly, by the reverse case this guards against — an outer edit
 * reconciling while this editor still has a leftover selection) makes
 * Lexical think there's a selection here it still needs to keep in sync;
 * once nothing is recorded, there's nothing for it to (wrongly) restore.
 * See `FileDirectiveArrowPlugin.tsx`'s header for the mirror-image bug
 * this was first caught as (outer -> caption instead of caption -> outer)
 * and the fuller investigation notes.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { isAtDocumentEnd, isAtDocumentStart } from "./CrossEditorArrowPlugin";
import {
  focusOuterEditorAcrossBoundary,
  focusSiblingFileCaption,
  registerFileCaption,
} from "./fileCaptionFlow";
import { getTopLevelBlock } from "./SlashCommandPlugin";
import type { OxEditorGroupMember } from "./OxEditorGroup";

export default function FileCaptionArrowPlugin({
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
    const unregister = registerFileCaption(outerEditor, nodeKey, member);

    function handleArrow(direction: 1 | -1) {
      return (event: KeyboardEvent): boolean => {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const atBoundary =
          direction === 1 ? isAtDocumentEnd(selection) : isAtDocumentStart(selection);
        if (!atBoundary) return false;

        const movedToSibling = focusSiblingFileCaption(outerEditor, nodeKey, direction);
        if (movedToSibling) {
          event.preventDefault();
          return true;
        }

        // Leaving THIS caption entirely (not just hopping to a sibling
        // caption, which stays within the same registry/mechanism) — see
        // this file's header for why the selection here has to be
        // cleared before handing focus to the outer editor.
        $setSelection(null);
        const moved = focusOuterEditorAcrossBoundary(outerEditor, nodeKey, direction);
        if (!moved) return false;

        event.preventDefault();
        return true;
      };
    }

    function handleEnter(event: KeyboardEvent | null): boolean {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

      const block = getTopLevelBlock(selection.anchor.getNode());
      if (!$isParagraphNode(block) || block.getChildrenSize() !== 0) return false;

      // An empty line with nothing else in the caption isn't an "escape"
      // signal yet — it's just the caption's normal empty starting state
      // (or the single-Enter-so-far state), so ordinary Enter behavior
      // (padding it with another blank row) still applies.
      if (!block.getPreviousSibling() && !block.getNextSibling()) return false;

      $setSelection(null); // see this file's header
      const escaped = focusOuterEditorAcrossBoundary(outerEditor, nodeKey, 1);
      if (!escaped) return false;

      block.remove();
      event?.preventDefault();
      return true;
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
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      handleEnter,
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregister();
      unregisterDown();
      unregisterUp();
      unregisterEnter();
    };
  }, [editor, outerEditor, nodeKey]);

  return null;
}
