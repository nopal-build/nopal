/**
 * The OUTER-editor half of making a `::file{...}` directive feel like a
 * fully integrated row rather than a separate little box — the opposite
 * direction of `fileCaptionFlow.ts`/`FileCaptionArrowPlugin.tsx` (caption
 * -> outer editor). This plugin handles outer editor -> caption:
 *
 * - ArrowDown approaching a file directive from above, or ArrowUp
 *   approaching one from below, lands the caret directly in that file's
 *   OWN caption editor (at its start/end respectively) instead of either
 *   the browser's default "jump straight past the whole non-editable
 *   decorator" behavior, or `InteractablesPlugin`'s select-as-a-unit
 *   treatment (which only covers Left/Right/Backspace/Delete, not
 *   vertical movement, so a file directive was previously unreachable at
 *   all by ArrowUp/ArrowDown alone).
 * - Backspace approaching a file directive from below (i.e. from the
 *   start of whatever comes right after it) lands the caret at the END
 *   of its caption instead — matching how backspacing at the start of an
 *   ordinary line merges the caret into the end of the PREVIOUS line's
 *   content, rather than `InteractablesPlugin`'s usual select-then-delete
 *   treatment for decorators. `InteractablesPlugin.tsx`'s own
 *   `isFileDirective` check steps its (higher-priority) Backspace handler
 *   aside specifically for file directives so this one gets a chance to
 *   run — a file directive can still be removed via its own remove
 *   button, or Delete approaching it from the OTHER side (unaffected).
 *
 * Reuses `siblingBeforeCollapsedCaret`/`siblingAfterCollapsedCaret` from
 * `InteractablesPlugin.tsx` — the same "what's immediately adjacent to a
 * collapsed caret, climbing up through ancestors as needed" check that
 * plugin already relies on for Left/Right, so this and that plugin always
 * agree on what "adjacent" means.
 *
 * Mounted unconditionally on every Editing-mode `OxEditor` (like
 * `InteractablesPlugin`/`MinRowsPlugin`), including a `::file{...}`
 * caption's own nested editor — harmless there since captions never
 * allow inserting their OWN nested file directives (`allowFileAttachments`
 * is never passed to a caption), so the "adjacent sibling is a file"
 * condition simply never matches inside one.
 *
 * `$setSelection(null)` is called on THIS (outer) editor before handing
 * focus to the caption — confirmed necessary by direct testing, not just
 * theorized. Without it: entering the caption this way worked fine at
 * first glance (focus visibly landed there), but the very NEXT keystroke
 * typed into the caption bounced straight back out to this outer editor,
 * landing wherever this editor's caret happened to be before the key was
 * pressed — reproduced reliably, including confirming a plain deferred
 * focus-shift (a microtask, or matching `fileDirective.ts`'s
 * `focusFileCaptionOnceMounted`'s rAF-polling pattern) did NOT fix it, so
 * this isn't a timing/ordering issue. What actually happens: typing in
 * the caption round-trips its OWN onChange into `editingNodes.tsx`'s
 * `editDirectiveAttr`, which mutates THIS editor's OxDirectiveNode and
 * commits a normal update on THIS editor — and if this editor still has
 * its OLD RangeSelection recorded from before (unchanged, since moving
 * focus into the caption never touched it), Lexical's reconciliation for
 * that unrelated commit re-asserts it into the native DOM, which — since
 * the caption's contenteditable is a DOM DESCENDANT of this editor's own
 * root, not a sibling — visibly steals focus back. Clearing the selection
 * here means there's nothing stale left to (wrongly) restore. The
 * mirror-image fix lives in `FileCaptionArrowPlugin.tsx`, for the reverse
 * direction.
 */

import { useEffect } from "react";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type RangeSelection,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { siblingAfterCollapsedCaret, siblingBeforeCollapsedCaret } from "./InteractablesPlugin";
import { $isOxDirectiveNode } from "./editingNodes";
import { getFileCaptionMember } from "./fileCaptionFlow";
import type { OxEditorGroupMember } from "./OxEditorGroup";

export default function FileDirectiveArrowPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    /** Shared by ArrowUp/ArrowDown and Backspace — all three boil down to
     * "the collapsed caret is immediately adjacent (in `siblingDirection`)
     * to a `::file{...}` directive that has a mounted caption; if so,
     * hand focus to that caption and report success." */
    function adjacentFileCaption(
      selection: RangeSelection,
      siblingDirection: 1 | -1,
    ): OxEditorGroupMember | null {
      const sibling =
        siblingDirection === 1
          ? siblingAfterCollapsedCaret(selection)
          : siblingBeforeCollapsedCaret(selection);
      if (!$isOxDirectiveNode(sibling) || sibling.getMdastNode().name !== "file") return null;
      // This editor IS the "outer editor" the caption registered itself
      // against — `editingNodes.tsx` passes `fileCaptionFlow={{
      // outerEditor: editor, nodeKey }}` using this exact same
      // `LexicalComposerContext` reference.
      return getFileCaptionMember(editor, sibling.getKey());
    }

    function handleArrow(direction: 1 | -1) {
      return (event: KeyboardEvent): boolean => {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const member = adjacentFileCaption(selection, direction);
        if (!member) return false;

        event.preventDefault();
        $setSelection(null); // see this file's header
        if (direction === 1) member.focusStart();
        else member.focusEnd();
        return true;
      };
    }

    function handleBackspace(event: KeyboardEvent | null): boolean {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

      // Backspace looks at what's BEFORE the caret — same direction as
      // ArrowUp's "sibling before" check.
      const member = adjacentFileCaption(selection, -1);
      if (!member) return false;

      event?.preventDefault();
      $setSelection(null); // see this file's header
      member.focusEnd();
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
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      handleBackspace,
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterDown();
      unregisterUp();
      unregisterBackspace();
    };
  }, [editor]);

  return null;
}
