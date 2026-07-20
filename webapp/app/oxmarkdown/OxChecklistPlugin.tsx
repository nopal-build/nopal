/**
 * Everything checklist-interaction-related that `@lexical/list`'s own
 * `CheckListPlugin` used to provide, rebuilt on `OxListItemNode` instead —
 * click-to-toggle, Escape/Space/Arrow keyboard control when a checkbox is
 * focused, and Enter-key handling. We stopped using `<CheckListPlugin />`
 * entirely (see `OxListItemNode.ts`'s header for why: it gates everything
 * on the parent LIST's declared type, which we deliberately never set to
 * `"check"`), so every one of those behaviors has to be re-registered here
 * against our own `isRealCheckbox()` instead. Read directly from
 * `@lexical/list`'s source (not guessed) to make sure this is real parity,
 * not a partial reimplementation — file-by-file:
 *   - Root `click`/`pointerdown` listeners + the exact hit-test math
 *     (`registerCheckList`/`handleCheckItemEvent` in `LexicalList.dev.js`).
 *   - `KEY_ARROW_LEFT_COMMAND` focusing the checkbox from text position 0.
 *   - `KEY_ARROW_UP/DOWN_COMMAND` moving focus between list items.
 *   - `KEY_ESCAPE_COMMAND`/`KEY_SPACE_COMMAND` for a focused checkbox.
 *
 * The Enter-key part is genuinely new, not ported — see
 * `INSERT_PARAGRAPH_COMMAND`'s handler below for the graduated-outdent
 * model (checkbox → plain bullet → exit), and why it no longer needs to
 * split into a second list to represent the middle step (that was the
 * actual bug: a previous version split into a second `<ul>`, which
 * silently changed the OUTPUT markdown — an extra blank line and a
 * switched bullet character, to keep two adjacent lists distinct — with
 * nothing on screen showing it. `checked` is now just a plain field on the
 * SAME item, so there's no second list, ever, and nothing for the
 * rendered view and the exported markdown to disagree about.
 */

import { useEffect } from "react";
import {
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $getNearestNodeFromDOMNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_SPACE_COMMAND,
  type LexicalNode,
} from "lexical";
import { $isListItemNode, $isListNode, $createListNode } from "@lexical/list";
import { calculateZoomLevel } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createOxListItemNode,
  $getNearestOxListItemNode,
  $isOxListItemNode,
  type OxListItemNode,
} from "./OxListItemNode";

// ── Shared tree helpers (mirroring @lexical/list's own, unexported ones) ──

/** Same walk `@lexical/list`'s `findCheckListItemSibling` does: the nearest
 * actual list-item sibling in document order, stepping out of / into
 * nested lists as needed. Deliberately NOT filtered to checkbox items —
 * the original isn't either; arrowing from a checkbox to an adjacent plain
 * bullet still moves focus there. */
function findListItemSibling(node: LexicalNode, backward: boolean): LexicalNode | null {
  let sibling = backward ? node.getPreviousSibling() : node.getNextSibling();
  let parent: LexicalNode | null = node;
  while (sibling == null && $isListItemNode(parent)) {
    const list: LexicalNode | null = parent.getParentOrThrow().getParent();
    parent = list;
    if (list != null) sibling = backward ? list.getPreviousSibling() : list.getNextSibling();
  }
  while ($isListItemNode(sibling)) {
    const firstOrLast = backward ? sibling.getLastChild() : sibling.getFirstChild();
    if (!$isListNode(firstOrLast)) return sibling;
    sibling = backward ? firstOrLast.getLastChild() : firstOrLast.getFirstChild();
  }
  return null;
}

/** Mirrors `$removeHighestEmptyListParent`: removes `node`, and any
 * now-empty list/list-item ancestor chain left behind by that removal. */
function removeHighestEmptyListParent(node: LexicalNode): void {
  let ptr: LexicalNode = node;
  while (ptr.getNextSibling() == null && ptr.getPreviousSibling() == null) {
    const parent = ptr.getParent();
    if (parent == null || !($isListItemNode(parent) || $isListNode(parent))) break;
    ptr = parent;
  }
  ptr.remove();
}

/** An empty checkbox item stepping OUT of a real indent level first (see
 * this file's header) — preserves `checked` across the outdent, unlike
 * `@lexical/list`'s own version of this (which creates a brand new plain
 * item with no checked state at all; fine for ITS model, wrong for ours,
 * since here checkbox-ness is real per-item state worth keeping). */
function outdentCheckboxOneLevel(anchor: OxListItemNode, list: LexicalNode, grandparent: OxListItemNode): boolean {
  const replacement = $createOxListItemNode(anchor.getChecked());
  grandparent.insertAfter(replacement);
  replacement.selectStart();

  const nextSiblings = anchor.getNextSiblings();
  if (nextSiblings.length > 0 && $isListNode(list)) {
    const newList = $createListNode(list.getListType(), list.getListType() === "number" ? list.getStart() : 1);
    const wrapper = $createOxListItemNode();
    wrapper.append(newList);
    replacement.insertAfter(wrapper);
    newList.append(...nextSiblings);
  }

  removeHighestEmptyListParent(anchor);
  return true;
}

// ── The plugin ──────────────────────────────────────────────────────────

export default function OxChecklistPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function getActiveItem(): HTMLElement | null {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active.tagName !== "LI") return null;
      let isOurs = false;
      // `{editor}` is required here — without it, `.read()` throws "Unable
      // to find an active editor" when called from a raw DOM event handler
      // (confirmed directly, not assumed — this exact call is what broke
      // click-to-toggle entirely on the first pass at this file).
      editor.getEditorState().read(() => {
        const node = $getNearestNodeFromDOMNode(active);
        isOurs = $isOxListItemNode(node) && node.isRealCheckbox();
      }, { editor });
      return isOurs ? active : null;
    }

    function handleArrowUpOrDown(event: KeyboardEvent, backward: boolean): boolean {
      const activeItem = getActiveItem();
      if (activeItem == null) return false;
      let handled = false;
      editor.update(() => {
        const listItem = $getNearestNodeFromDOMNode(activeItem);
        if (!$isListItemNode(listItem)) return;
        const next = findListItemSibling(listItem, backward);
        if (next == null) return;
        next.selectStart();
        const dom = editor.getElementByKey(next.getKey());
        if (dom != null) {
          event.preventDefault();
          handled = true;
          setTimeout(() => dom.focus(), 0);
        }
      });
      return handled;
    }

    function handleCheckItemEvent(event: MouseEvent, callback: () => void): void {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Ignore clicks on an LI whose content is a nested list, not text.
      const firstChild = target.firstChild;
      if (firstChild instanceof HTMLElement && (firstChild.tagName === "UL" || firstChild.tagName === "OL")) return;

      let isCheckbox = false;
      editor.getEditorState().read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        isCheckbox = $isOxListItemNode(node) && node.isRealCheckbox();
      }, { editor });
      if (!isCheckbox) return;

      const rect = target.getBoundingClientRect();
      const zoom = calculateZoomLevel(target);
      const clientX = event.clientX / zoom;
      // `::after`, not `::before` — the checkbox box/checkmark live there
      // now, with `::before` freed for the same gutter dash every other
      // list item gets (see `oxmarkdown.css`'s "Editing mode: checklist"
      // section for why).
      const afterStyles = window.getComputedStyle(target, "::after");
      const afterWidthInPixels = parseFloat(afterStyles.width) || 0;
      const isTouch = (event as PointerEvent).pointerType === "touch";
      const padding = isTouch ? 32 : 0;

      const withinGlyph =
        target.dir === "rtl"
          ? clientX < rect.right + padding && clientX > rect.right - afterWidthInPixels - padding
          : clientX > rect.left - padding && clientX < rect.left + afterWidthInPixels + padding;
      if (withinGlyph) callback();
    }

    function handleClick(event: MouseEvent): void {
      handleCheckItemEvent(event, () => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        // Deliberately NOT `target.focus()` here, unlike the original
        // `@lexical/list` version this is ported from — confirmed directly
        // that calling it inside this `editor.update()` left the editor in
        // a state where subsequent ordinary typing silently failed to
        // register. The trade-off: clicking a checkbox no longer makes it
        // the "active" item for immediate Arrow-Up/Down navigation (see
        // `getActiveItem`, which keys off `document.activeElement`) — a
        // real, minor scope reduction, not an oversight. Arrowing onto a
        // checkbox via ordinary caret navigation is unaffected either way.
        editor.update(() => {
          const node = $getNearestNodeFromDOMNode(target);
          if ($isOxListItemNode(node)) {
            node.setChecked(!node.getChecked());
          }
        });
      });
    }

    function handlePointerDown(event: MouseEvent): void {
      handleCheckItemEvent(event, () => event.preventDefault());
    }

    const unregisterRoot = editor.registerRootListener((rootElement, prevElement) => {
      if (rootElement != null) {
        rootElement.addEventListener("click", handleClick);
        rootElement.addEventListener("pointerdown", handlePointerDown);
      }
      if (prevElement != null) {
        prevElement.removeEventListener("click", handleClick);
        prevElement.removeEventListener("pointerdown", handlePointerDown);
      }
    });

    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleArrowUpOrDown(event, false),
      COMMAND_PRIORITY_LOW,
    );
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleArrowUpOrDown(event, true),
      COMMAND_PRIORITY_LOW,
    );
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (getActiveItem() == null) return false;
        editor.getRootElement()?.focus();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterSpace = editor.registerCommand(
      KEY_SPACE_COMMAND,
      (event) => {
        const activeItem = getActiveItem();
        if (activeItem == null || !editor.isEditable()) return false;
        editor.update(() => {
          const node = $getNearestNodeFromDOMNode(activeItem);
          if ($isOxListItemNode(node)) {
            event.preventDefault();
            node.setChecked(!node.getChecked());
          }
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterArrowLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        return editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const anchor = selection.anchor;
          const isElement = anchor.type === "element";
          if (!isElement && anchor.offset !== 0) return false;
          const anchorNode = anchor.getNode();
          const listItem = $getNearestOxListItemNode(anchorNode);
          if (!listItem || !listItem.isRealCheckbox()) return false;
          if (!isElement && listItem.getFirstDescendant() !== anchorNode) return false;
          const dom = editor.getElementByKey(listItem.getKey());
          if (dom != null && document.activeElement !== dom) {
            dom.focus();
            event.preventDefault();
            return true;
          }
          return false;
        }, { editor });
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterEnter = editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const anchor = selection.anchor.getNode();
        if (!$isOxListItemNode(anchor) || anchor.getChildrenSize() !== 0) return false;
        if (anchor.getChecked() === undefined) return false; // plain bullet — defer to @lexical/list's default

        const list = anchor.getParent();
        if (!$isListNode(list)) return false;
        const grandparent = list.getParent();

        if ($isOxListItemNode(grandparent)) {
          return outdentCheckboxOneLevel(anchor, list, grandparent);
        }
        if ($isRootOrShadowRoot(grandparent)) {
          anchor.setChecked(undefined); // same item, same list — just drop the checkbox
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterRoot();
      unregisterArrowDown();
      unregisterArrowUp();
      unregisterEscape();
      unregisterSpace();
      unregisterArrowLeft();
      unregisterEnter();
    };
  }, [editor]);

  return null;
}
