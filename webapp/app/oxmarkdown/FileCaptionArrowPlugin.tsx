/**
 * Mounted inside a `::file{...}` directive's caption editor (see
 * `editingNodes.tsx`) — registers this caption into `fileCaptionFlow.ts`'s
 * registry (scoped to the OUTER editor this file directive lives in) and
 * makes ArrowDown/ArrowUp at the caption's own true start/end flow into a
 * sibling file directive's caption, if one is immediately adjacent. See
 * `fileCaptionFlow.ts`'s header for the full reasoning and scope notes.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
} from "lexical";
import { isAtDocumentEnd, isAtDocumentStart } from "./CrossEditorArrowPlugin";
import { focusSiblingFileCaption, registerFileCaption } from "./fileCaptionFlow";
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

        const moved = focusSiblingFileCaption(outerEditor, nodeKey, direction);
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
