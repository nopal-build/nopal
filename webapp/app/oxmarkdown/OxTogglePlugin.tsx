/**
 * Everything Toggle List interaction beyond what plain Lexical
 * `ElementNode`s already give for free (typing, arrows, ordinary
 * Backspace/Enter merging — see `OxToggleNode.ts`'s header):
 *
 * - Click-to-collapse/expand. Modeled directly on `OxChecklistPlugin.tsx`'s
 *   own root-level click + hit-test pattern (same reasoning: the toggle
 *   CARET is a CSS `::before` pseudo-element on `.ox-toggle-summary`, per
 *   the "gutter markers" design language already used for
 *   `#`/`##`/`>`/the checkbox glyph — see the `oxmarkdown` skill — not a
 *   real DOM child, so there's no element to attach a click handler to
 *   directly; instead this measures the pseudo-element's OWN computed
 *   `left`/`width` via `getComputedStyle` and checks the click's `clientX`
 *   against that region, so it stays correct regardless of exactly where
 *   the CSS positions the glyph).
 * - Double-Enter on an already-empty LAST body paragraph "escapes" to the
 *   outer document right after the toggle — same "hit Enter twice" idea
 *   `FileCaptionArrowPlugin.tsx` already uses for a file's caption,
 *   adapted for a body that can hold several real paragraphs (not just
 *   one line): the FIRST Enter on a toggle's initial (and only) empty
 *   body paragraph is ordinary — it creates a genuine second paragraph,
 *   which now has a real previous sibling — only THEN does pressing Enter
 *   again (on that now-empty paragraph) count as "done," matching
 *   double-Enter regardless of how much real content came before it.
 * - Backspace on a wholly EMPTY toggle (blank title, single blank body
 *   paragraph, nothing typed anywhere) removes the toggle outright rather
 *   than merging its two empty parts together — undoing the `> `
 *   conversion cleanly when nothing was ever added to it.
 */

import { useEffect } from "react";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
} from "lexical";
import { calculateZoomLevel } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestOxToggleNode,
  $isOxToggleNode,
  $isOxToggleSummaryNode,
  type OxToggleNode,
} from "./OxToggleNode";

const HIT_PADDING = { touch: 32, mouse: 12 };

/** The direct child of `toggle` that `node` lives inside (its own body
 * paragraph, or the summary) — walks up from whatever leaf the selection
 * anchor actually points at, mirroring `getTopLevelBlock`
 * (`SlashCommandPlugin.tsx`) but scoped to a toggle's own children
 * instead of the editor root's. */
function getToggleChildBlock(toggle: OxToggleNode, node: LexicalNode): LexicalNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if (parent === toggle) return current;
    current = parent;
  }
  return null;
}

/** A toggle counts as "empty" only when NOTHING has been typed anywhere
 * in it — a blank title and exactly one blank body paragraph (its
 * always-present minimum shape — see `OxToggleNode.ts`). Any real content
 * (a second body paragraph, a non-empty title or paragraph) disqualifies
 * it, even if that content is itself currently empty in some other way. */
function isEmptyToggle(toggle: OxToggleNode): boolean {
  const children = toggle.getChildren();
  if (children.length !== 2) return false;
  const [summary, body] = children;
  if (!$isOxToggleSummaryNode(summary) || summary.getTextContentSize() !== 0) return false;
  if (!$isParagraphNode(body) || body.getTextContentSize() !== 0) return false;
  return true;
}

export default function OxTogglePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function findSummaryElement(target: EventTarget | null): HTMLElement | null {
      if (!(target instanceof HTMLElement)) return null;
      return target.closest<HTMLElement>(".ox-toggle-summary");
    }

    function withinCaretGlyph(target: HTMLElement, event: MouseEvent): boolean {
      const rect = target.getBoundingClientRect();
      const zoom = calculateZoomLevel(target);
      const clientX = event.clientX / zoom;
      const beforeStyles = window.getComputedStyle(target, "::before");
      const beforeWidth = parseFloat(beforeStyles.width) || 0;
      // The glyph sits at a (possibly negative, gutter) `left` offset
      // relative to `target`'s own box — read directly from computed
      // style rather than assumed, so this can't silently drift out of
      // sync with wherever `oxmarkdown.css` actually positions it.
      const beforeLeft = parseFloat(beforeStyles.left) || 0;
      const isTouch = (event as PointerEvent).pointerType === "touch";
      const padding = isTouch ? HIT_PADDING.touch : HIT_PADDING.mouse;
      const glyphStart = rect.left + beforeLeft;
      return clientX > glyphStart - padding && clientX < glyphStart + beforeWidth + padding;
    }

    function handleClick(event: MouseEvent): void {
      const target = findSummaryElement(event.target);
      if (!target) return;
      if (!withinCaretGlyph(target, event)) return;

      let isToggleSummary = false;
      editor.getEditorState().read(
        () => {
          const node = $getNearestNodeFromDOMNode(target);
          isToggleSummary = $isOxToggleSummaryNode(node);
        },
        { editor },
      );
      if (!isToggleSummary) return;

      event.preventDefault();
      editor.update(() => {
        const node: LexicalNode | null = $getNearestNodeFromDOMNode(target);
        const toggle = $getNearestOxToggleNode(node);
        if (toggle) toggle.setCollapsed(!toggle.getCollapsed());
      });
    }

    const unregisterRoot = editor.registerRootListener((rootElement, prevElement) => {
      if (rootElement != null) rootElement.addEventListener("click", handleClick);
      if (prevElement != null) prevElement.removeEventListener("click", handleClick);
    });

    function handleEnter(event: KeyboardEvent | null): boolean {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

      const toggle = $getNearestOxToggleNode(selection.anchor.getNode());
      if (!toggle) return false;

      const block = getToggleChildBlock(toggle, selection.anchor.getNode());
      if (!$isParagraphNode(block) || block.getChildrenSize() !== 0) return false;
      // Only the LAST child of the toggle — escaping from a blank line in
      // the MIDDLE of real body content would strand whatever follows it.
      if (block.getNextSibling() !== null) return false;
      // The toggle's own initial (and, so far, only) body paragraph isn't
      // an escape signal yet — that's just its normal untouched starting
      // state (or the single-Enter-so-far state); a REAL previous body
      // paragraph has to exist first (not just the summary).
      const prev = block.getPreviousSibling();
      if (!prev || $isOxToggleSummaryNode(prev)) return false;

      event?.preventDefault();
      block.remove();
      const following = toggle.getNextSibling();
      if (following) {
        following.selectStart();
      } else {
        const paragraph = $createParagraphNode();
        toggle.insertAfter(paragraph);
        paragraph.selectStart();
      }
      return true;
    }

    function handleBackspace(event: KeyboardEvent | null): boolean {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      if (selection.anchor.offset !== 0) return false;

      const toggle = $getNearestOxToggleNode(selection.anchor.getNode());
      if (!toggle) return false;

      const block = getToggleChildBlock(toggle, selection.anchor.getNode());
      // Only from the absolute start of the FIRST child (the summary) or
      // the sole body paragraph right after it — anywhere else, ordinary
      // Backspace behavior (e.g. merging two real body paragraphs) still
      // applies untouched.
      const isFirstChild = block === toggle.getFirstChild();
      const isSoleBodyParagraph =
        $isParagraphNode(block) && $isOxToggleSummaryNode(block.getPreviousSibling());
      if (!isFirstChild && !isSoleBodyParagraph) return false;
      if (!isEmptyToggle(toggle)) return false;

      event?.preventDefault();
      const prevSibling = toggle.getPreviousSibling();
      if ($isElementNode(prevSibling)) {
        toggle.remove();
        prevSibling.selectEnd();
      } else {
        // Defensive only — `LeadingBlockGuardPlugin` guarantees a toggle
        // always has a real previous sibling, so this shouldn't happen.
        const paragraph = $createParagraphNode();
        toggle.insertBefore(paragraph);
        toggle.remove();
        paragraph.selectStart();
      }
      return true;
    }

    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      handleEnter,
      COMMAND_PRIORITY_LOW,
    );
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      handleBackspace,
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterRoot();
      unregisterEnter();
      unregisterBackspace();
    };
  }, [editor]);

  return null;
}
