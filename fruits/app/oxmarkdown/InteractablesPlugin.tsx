/**
 * Generic select-then-delete keyboard behavior for Editing mode, per the
 * oxmarkdown skill's Interactables model — implemented ONCE, against
 * Lexical's own generic `$isDecoratorNode`, so it works for
 * `OxDirectiveNode` and `OxOpaqueNode` today and any future decorator (an
 * `@mention` node) for free, with no new plugin code and no special
 * contract to implement.
 *
 * Deliberately NOT involved in task-checkbox behavior — a checklist item's
 * `checked` flag is real `ListItemNode` state, not inline text (see
 * `@lexical/list`'s `registerCheckList`), so Backspace at the start of a
 * checklist item's label falls through to Lexical's ordinary
 * list-outdent/merge behavior instead.
 *
 * Behavior implemented here (see the skill's "Interactables" section):
 *   - Arrow-key approaching a decorator (collapsed caret, next/previous
 *     sibling is one) selects it as a whole unit instead of moving the
 *     caret inside/through it.
 *   - Arrow-key away from an already-selected decorator moves the caret to
 *     just outside it, rather than re-selecting or getting stuck.
 *   - Backspace or Delete approaching a decorator selects it first (1st
 *     press); a SECOND press of either key deletes it outright. Both keys
 *     behave identically once something is selected — an earlier version
 *     had Backspace revert to raw markdown text instead of deleting, kept
 *     separately editable; removed deliberately, not as an oversight (see
 *     `editingNodes.tsx`'s header for why: retyping a directive from
 *     scratch via `/` is simple enough that the extra machinery a soft
 *     revert step needed — including escaping a reverted directive's raw
 *     text on export so it wouldn't be mistaken for a live directive again
 *     — wasn't worth it). Deleting relies on ordinary undo to bring
 *     something back, same as any other deletion.
 *   - EXCEPTION: Backspace approaching a `::file{...}` directive
 *     specifically does NOT select it as a unit — `isFileDirective`
 *     steps this handler aside so `FileDirectiveArrowPlugin.tsx` can
 *     land the caret in its caption's END instead, matching how
 *     backspacing at the start of a line ordinarily merges into the end
 *     of the PREVIOUS line's content. A file directive can still be
 *     removed via its own remove button, or Delete approaching it from
 *     the OTHER side (unaffected — only this one Backspace case changes).
 *
 * `event.preventDefault()` is called explicitly in every branch that
 * returns `true`, at `COMMAND_PRIORITY_CRITICAL` for Backspace/Delete —
 * returning `true` from a Lexical command handler does NOT by itself
 * suppress the native contentEditable behavior running in parallel; the
 * Lexical-vs-custom foundation spike (oxmarkdown skill, TODO 1) hit exactly
 * this as a silent text-corruption bug before adding both.
 *
 * `siblingBeforeCollapsedCaret`/`siblingAfterCollapsedCaret` are exported
 * for `FileDirectiveArrowPlugin.tsx` — the exact same "what's immediately
 * adjacent to a collapsed caret, climbing up through ancestors as needed"
 * check is also what that plugin needs to detect "the next/previous row
 * IS a `::file{...}` directive" for ArrowDown/ArrowUp, not just Left/Right.
 */

import { useEffect } from "react";
import {
  $createNodeSelection,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isOxDirectiveNode } from "./editingNodes";

/** `::file{...}` gets its own, more specific Backspace behavior
 * (`FileDirectiveArrowPlugin.tsx` — lands the caret in its caption's
 * END, like backspacing into the end of a normal previous line, rather
 * than select-then-delete) so this generic handler has to recognize and
 * step aside for it specifically — otherwise, being registered at
 * `COMMAND_PRIORITY_CRITICAL`, it would always win first and a file
 * directive could never be reached that way. */
function isFileDirective(node: LexicalNode | null): boolean {
  return $isOxDirectiveNode(node) && node.getMdastNode().name === "file";
}

/** Walks up through ancestors while there's no previous sibling at the
 * current level, so a caret at the very START of a block (e.g. a fresh
 * paragraph right after a block-level directive) still finds that
 * directive as "the thing immediately before the caret" — not just an
 * inline decorator sharing the SAME immediate parent. Per TODO 7 in the
 * oxmarkdown skill: entering an interactable selects it regardless of
 * which direction/level the cursor approaches from. Stops at the nearest
 * root/shadow-root boundary (found by testing: without this walk-up, an
 * arrow-key approaching a block-level directive from an adjacent paragraph
 * silently did nothing). */
export function siblingBeforeCollapsedCaret(selection: RangeSelection): LexicalNode | null {
  const anchor = selection.anchor;
  let current: LexicalNode | null;
  if (anchor.type === "text") {
    if (anchor.offset !== 0) return null;
    current = anchor.getNode();
  } else {
    const el = anchor.getNode();
    if (!$isElementNode(el)) return null;
    if (anchor.offset > 0) {
      // Mid-element: a real earlier sibling exists within THIS element —
      // no need to climb, and climbing would incorrectly skip past it.
      return el.getChildAtIndex(anchor.offset - 1) ?? null;
    }
    current = el; // at the very start of this element — climb from here
  }
  while (current) {
    const prev = current.getPreviousSibling();
    if (prev) return prev;
    current = current.getParent();
    if (!current || $isRootOrShadowRoot(current)) return null;
  }
  return null;
}

export function siblingAfterCollapsedCaret(selection: RangeSelection): LexicalNode | null {
  const anchor = selection.anchor;
  let current: LexicalNode | null;
  if (anchor.type === "text") {
    const node = anchor.getNode();
    if (anchor.offset !== node.getTextContentSize()) return null;
    current = node;
  } else {
    const el = anchor.getNode();
    if (!$isElementNode(el)) return null;
    const child = el.getChildAtIndex(anchor.offset);
    if (child) return child; // mid-element, a real "next child" exists — no walk-up needed
    current = el;
  }
  while (current) {
    const next = current.getNextSibling();
    if (next) return next;
    current = current.getParent();
    if (!current || $isRootOrShadowRoot(current)) return null;
  }
  return null;
}

function selectNodeAsUnit(node: LexicalNode): void {
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

export default function InteractablesPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();

        if ($isNodeSelection(selection)) {
          const nodes = selection.getNodes();
          if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;
          event?.preventDefault();
          nodes[0].remove();
          return true;
        }

        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const sibling = siblingBeforeCollapsedCaret(selection);
          if ($isDecoratorNode(sibling) && !isFileDirective(sibling)) {
            event?.preventDefault();
            selectNodeAsUnit(sibling);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    const unregisterDelete = editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();

        if ($isNodeSelection(selection)) {
          const nodes = selection.getNodes();
          if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;
          event?.preventDefault();
          nodes[0].remove();
          return true;
        }

        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const sibling = siblingAfterCollapsedCaret(selection);
          if ($isDecoratorNode(sibling)) {
            event?.preventDefault();
            selectNodeAsUnit(sibling);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    function handleArrow(direction: "left" | "right", event: KeyboardEvent | null): boolean {
      const selection = $getSelection();

      if ($isNodeSelection(selection)) {
        const nodes = selection.getNodes();
        if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;
        event?.preventDefault();
        const node = nodes[0];
        if (direction === "right") node.selectNext(0, 0);
        else node.selectPrevious();
        return true;
      }

      if ($isRangeSelection(selection) && selection.isCollapsed()) {
        const sibling =
          direction === "right"
            ? siblingAfterCollapsedCaret(selection)
            : siblingBeforeCollapsedCaret(selection);
        if ($isDecoratorNode(sibling)) {
          event?.preventDefault();
          selectNodeAsUnit(sibling);
          return true;
        }
      }
      return false;
    }

    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => handleArrow("left", event),
      COMMAND_PRIORITY_LOW,
    );
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => handleArrow("right", event),
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterBackspace();
      unregisterDelete();
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}
