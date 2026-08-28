/**
 * The OUTER-editor half of making a `::card{...}` directive feel like a
 * fully integrated row rather than a separate little box — same job
 * `FileDirectiveArrowPlugin.tsx` does for `::file{...}` captions, adapted
 * for cards (see `cardFlow.ts`'s header for the one direction this covers
 * today, and the deliberately deferred reverse direction).
 *
 * ArrowDown approaching a card directive from above, or ArrowUp
 * approaching one from below, lands the caret directly in that card's OWN
 * nested editor (at its start/end respectively) instead of the browser's
 * default "jump straight past the whole non-editable decorator" behavior.
 *
 * Reuses `siblingBeforeCollapsedCaret`/`siblingAfterCollapsedCaret` from
 * `InteractablesPlugin.tsx` — the same "what's immediately adjacent to a
 * collapsed caret, climbing up through ancestors as needed" check that
 * plugin already relies on for Left/Right, so this and that plugin always
 * agree on what "adjacent" means.
 *
 * Mounted unconditionally on every Editing-mode `OxEditor` (like
 * `FileDirectiveArrowPlugin`), including a card's OWN nested editor —
 * harmless there since a card rendered inside another card resolves to
 * nothing (`resolveCard` isn't threaded that deep — see the `oxmarkdown`
 * skill's Card section), so the "adjacent sibling is a card" condition
 * simply never matches inside one.
 *
 * `$setSelection(null)` before handing off focus — the SAME real pitfall
 * `FileDirectiveArrowPlugin.tsx`'s header documents in full (confirmed by
 * direct testing there, not re-derived here): whichever editor hands
 * focus OFF must clear its own recorded selection first, or the next
 * keystroke typed in the newly-focused editor bounces back.
 */

import { useEffect } from "react";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type RangeSelection,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { siblingAfterCollapsedCaret, siblingBeforeCollapsedCaret } from "./InteractablesPlugin";
import { $isOxDirectiveNode } from "./editingNodes";
import { getCardEditorMember } from "./cardFlow";
import type { OxEditorGroupMember } from "./OxEditorGroup";

export default function CardDirectiveArrowPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function adjacentCardEditor(
      selection: RangeSelection,
      siblingDirection: 1 | -1,
    ): OxEditorGroupMember | null {
      const sibling =
        siblingDirection === 1
          ? siblingAfterCollapsedCaret(selection)
          : siblingBeforeCollapsedCaret(selection);
      if (!$isOxDirectiveNode(sibling) || sibling.getMdastNode().name !== "card") return null;
      // This editor IS the "outer editor" the card registered itself
      // against — `editingNodes.tsx` passes `cardFlow={{ outerEditor:
      // editor, nodeKey }}` using this exact same
      // `LexicalComposerContext` reference.
      return getCardEditorMember(editor, sibling.getKey());
    }

    function handleArrow(direction: 1 | -1) {
      return (event: KeyboardEvent): boolean => {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const member = adjacentCardEditor(selection, direction);
        if (!member) return false;

        event.preventDefault();
        $setSelection(null); // see this file's header
        if (direction === 1) member.focusStart();
        else member.focusEnd();
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
      unregisterDown();
      unregisterUp();
    };
  }, [editor]);

  return null;
}
