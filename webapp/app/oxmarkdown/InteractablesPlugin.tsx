/**
 * Generic select-then-act keyboard behavior for Editing mode, per the
 * oxmarkdown skill's Interactables model — implemented ONCE, against the
 * small `getRevertText()` duck type (see `editingNodes.tsx`), so it works
 * for `OxDirectiveNode` and `OxOpaqueNode` today and any future decorator
 * (an `@mention` node) for free, with no new plugin code.
 *
 * Deliberately NOT involved in task-checkbox behavior — a checklist item's
 * `checked` flag is real `ListItemNode` state, not inline text (see
 * `@lexical/list`'s `registerCheckList`), so there's nothing to "revert to
 * raw text": Backspace at the start of a checklist item's label falls
 * through to Lexical's ordinary list-outdent/merge behavior instead. TODO 6
 * (Backspace-reverts / Delete-removes, not symmetric) only ever applied to
 * directives and opaque passthrough content.
 *
 * Behavior implemented here (see the skill's "Interactables" section):
 *   - Arrow-key approaching a decorator (collapsed caret, next/previous
 *     sibling is one) selects it as a whole unit instead of moving the
 *     caret inside/through it.
 *   - Arrow-key away from an already-selected decorator moves the caret to
 *     just outside it, rather than re-selecting or getting stuck.
 *   - Backspace approaching one selects it first (1st press), then reverts
 *     it to its raw markdown text as an ordinary, further-editable TextNode
 *     (2nd press) — soft, undoable by continuing to edit.
 *   - Delete (forward) approaching one selects it first, then removes it
 *     outright (2nd press) — no revert step; relies on ordinary undo.
 *
 * `event.preventDefault()` is called explicitly in every branch that
 * returns `true`, at `COMMAND_PRIORITY_CRITICAL` for Backspace/Delete —
 * returning `true` from a Lexical command handler does NOT by itself
 * suppress the native contentEditable behavior running in parallel; the
 * Lexical-vs-custom foundation spike (oxmarkdown skill, TODO 1) hit exactly
 * this as a silent text-corruption bug before adding both.
 */

import { useEffect } from "react";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
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
import { isRevertibleOxNode } from "./editingNodes";

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
function siblingBeforeCollapsedCaret(selection: RangeSelection): LexicalNode | null {
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

function siblingAfterCollapsedCaret(selection: RangeSelection): LexicalNode | null {
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

/** A block-level decorator (a leaf/container directive, or an opaque
 * passthrough for something like a table) sits directly among block
 * siblings — often a direct child of the root, which only accepts
 * element/decorator nodes. Reverting it to a bare `TextNode` in place
 * would violate that and throw ("Only element or decorator nodes can be
 * inserted into the root node" — hit for real, not a hypothetical). An
 * inline decorator, by contrast, sits among ordinary inline siblings and a
 * bare `TextNode` there is exactly right. */
function isInlineNode(node: LexicalNode): boolean {
  const withIsInline = node as unknown as { isInline?: () => boolean };
  return typeof withIsInline.isInline === "function" ? withIsInline.isInline() : true;
}

function revertNodeToText(node: LexicalNode & { getRevertText(): string }): void {
  const text = $createTextNode(node.getRevertText());
  if (isInlineNode(node)) {
    node.replace(text);
  } else {
    node.replace($createParagraphNode().append(text));
  }
  text.select();
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
          if (nodes.length !== 1 || !isRevertibleOxNode(nodes[0])) return false;
          event?.preventDefault();
          revertNodeToText(nodes[0]);
          return true;
        }

        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const sibling = siblingBeforeCollapsedCaret(selection);
          if (isRevertibleOxNode(sibling)) {
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
          if (nodes.length !== 1 || !isRevertibleOxNode(nodes[0])) return false;
          event?.preventDefault();
          nodes[0].remove();
          return true;
        }

        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const sibling = siblingAfterCollapsedCaret(selection);
          if (isRevertibleOxNode(sibling)) {
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
        if (nodes.length !== 1 || !isRevertibleOxNode(nodes[0])) return false;
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
        if (isRevertibleOxNode(sibling)) {
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
