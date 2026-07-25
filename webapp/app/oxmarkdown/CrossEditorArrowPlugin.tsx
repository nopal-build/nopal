/**
 * Registers this editor into an ancestor `OxEditorGroup` (see that file)
 * under `groupId`, and makes ArrowDown/ArrowUp jump into the next/previous
 * group member, but ONLY when the caret is already at the true start/end
 * of THIS editor's own document — never when there's more to navigate
 * within it first (a line below in the same paragraph, the next list
 * item, the next block, ...).
 *
 * How that's decided: purely from the Lexical document TREE
 * (`isAtDocumentStart`/`isAtDocumentEnd` below), not by letting the
 * browser's native ArrowDown/Up run and observing whether anything moved.
 * That outcome-based approach was tried first and confirmed broken by
 * direct testing: a native ArrowDown from the end of a paragraph into a
 * following list (or from one list item into the next) can simply fail to
 * move the caret at all, which is indistinguishable from "there's nothing
 * more" if you're only watching what the browser did. Since every block in
 * an OxEditor document flows top-to-bottom in a single column (no floats/
 * columns/tables that could make visual order disagree with tree order),
 * "last leaf in tree order" and "last visual line" are the same position,
 * so the tree check alone is both correct and immune to that kind of
 * native-navigation quirk.
 *
 * Deliberately skipped when Shift/Alt/Meta/Ctrl is held — those extend a
 * selection or trigger word/line-jump shortcuts, neither of which this
 * plugin knows how to carry across an editor boundary.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type RangeSelection,
} from "lexical";
import { useOxEditorGroup, type OxEditorGroupMember } from "./OxEditorGroup";

/** True when `selection`'s anchor sits at the very last valid caret
 * position in the whole document — the last text offset of the last
 * leaf, or simply ON the last leaf when it isn't a text node (a line
 * break, a decorator, or an empty block that IS its own last descendant).
 * Exported for `fileCaptionFlow.ts`, which needs the exact same
 * true-boundary check for flowing between a `::file{...}` directive's
 * caption editor and its sibling captions within the SAME outer document. */
export function isAtDocumentEnd(selection: RangeSelection): boolean {
  const lastLeaf = $getRoot().getLastDescendant();
  if (lastLeaf === null) return true; // empty document
  const anchor = selection.anchor;
  if ($isTextNode(lastLeaf)) {
    return (
      anchor.type === "text" &&
      anchor.key === lastLeaf.getKey() &&
      anchor.offset === lastLeaf.getTextContentSize()
    );
  }
  return anchor.key === lastLeaf.getKey();
}

/** Mirror of `isAtDocumentEnd` for the very FIRST valid caret position. */
export function isAtDocumentStart(selection: RangeSelection): boolean {
  const firstLeaf = $getRoot().getFirstDescendant();
  if (firstLeaf === null) return true; // empty document
  const anchor = selection.anchor;
  if ($isTextNode(firstLeaf)) {
    return anchor.type === "text" && anchor.key === firstLeaf.getKey() && anchor.offset === 0;
  }
  return anchor.key === firstLeaf.getKey();
}

export default function CrossEditorArrowPlugin({ groupId }: { groupId: string }): null {
  const [editor] = useLexicalComposerContext();
  const group = useOxEditorGroup();

  useEffect(() => {
    if (!group) return;
    // Captured once, narrowed non-null, so the nested closures below don't
    // need their own `!group` checks (TS narrowing doesn't otherwise
    // persist into a function-returning-a-function closure).
    const activeGroup = group;

    const member: OxEditorGroupMember = {
      focusStart: () => editor.update(() => $getRoot().selectStart()),
      focusEnd: () => editor.update(() => $getRoot().selectEnd()),
    };
    activeGroup.register(groupId, member);

    function handleArrow(direction: 1 | -1) {
      return (event: KeyboardEvent): boolean => {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const atBoundary =
          direction === 1 ? isAtDocumentEnd(selection) : isAtDocumentStart(selection);
        // More to navigate within THIS editor first — leave the key alone
        // entirely so its normal (in-editor) behavior runs unaffected.
        if (!atBoundary) return false;

        const target = direction === 1 ? activeGroup.next(groupId) : activeGroup.prev(groupId);
        if (!target) return false; // real boundary, but no neighbor to jump to

        event.preventDefault();
        if (direction === 1) target.focusStart();
        else target.focusEnd();
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
      activeGroup.unregister(groupId);
      unregisterDown();
      unregisterUp();
    };
  }, [editor, group, groupId]);

  return null;
}
