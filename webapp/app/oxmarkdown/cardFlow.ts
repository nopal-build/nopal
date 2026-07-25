/**
 * Lets ArrowDown/ArrowUp in the OUTER editor enter a `::card{...}`
 * directive's own nested editor directly, instead of Lexical's default
 * "jump straight past the whole non-editable decorator" behavior — the
 * same job `fileCaptionFlow.ts`/`FileDirectiveArrowPlugin.tsx` already do
 * for `::file{...}` captions. A SEPARATE, independent registry rather
 * than reusing that one — Cards and captions are unrelated decorator
 * kinds with no reason to ever be looked up together.
 *
 * Now a fully symmetric pair, same as `fileCaptionFlow.ts`'s outer <->
 * caption flow: entering a card via arrow keys (`CardDirectiveArrowPlugin.tsx`,
 * mounted on the OUTER editor), and exiting one back to the outer editor
 * (`focusOuterEditorAcrossCardBoundary`, below, used by
 * `CardEditorArrowPlugin.tsx`, mounted INSIDE the card's own nested
 * editor). Deliberately still WITHOUT a double-Enter "escape" gesture
 * analogous to the file caption's own, or sibling-card-to-sibling-card
 * flow — neither was asked for; see the `oxmarkdown` skill's Card section.
 */

import {
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import type { OxEditorGroupMember } from "./OxEditorGroup";

const registries = new WeakMap<LexicalEditor, Map<string, OxEditorGroupMember>>();

function getRegistry(outerEditor: LexicalEditor): Map<string, OxEditorGroupMember> {
  let registry = registries.get(outerEditor);
  if (!registry) {
    registry = new Map();
    registries.set(outerEditor, registry);
  }
  return registry;
}

/** Called on mount/unmount by the card's own nested editor — the
 * registration half of `CardEditorArrowPlugin.tsx`, wired through
 * `OxEditor`'s `cardFlow` prop. */
export function registerCardEditor(
  outerEditor: LexicalEditor,
  nodeKey: string,
  member: OxEditorGroupMember,
): () => void {
  const registry = getRegistry(outerEditor);
  registry.set(nodeKey, member);
  return () => registry.delete(nodeKey);
}

/** Lands the caret in the OUTER editor's own content immediately before
 * (`direction: -1`) or after (`direction: 1`) the card directive
 * `nodeKey` — the fallback `CardEditorArrowPlugin.tsx` uses once its own
 * ArrowUp/ArrowDown-at-the-true-boundary check passes. Mirrors
 * `fileCaptionFlow.ts`'s `focusOuterEditorAcrossBoundary` exactly (same
 * reasoning throughout — see that function's own doc comment for the
 * full rationale, not repeated here):
 *   - A real sibling element already there → caret lands inside it, at
 *     its start (arriving from above) or end (arriving from below).
 *   - Nothing there at all (the true edge of the outer document) → a
 *     fresh blank paragraph is created and focused instead of leaving
 *     nowhere to go.
 *   - The adjacent sibling is some OTHER kind of block decorator (not a
 *     card) → returns `false`, leaving Lexical's own default jump-past
 *     behavior to apply. */
export function focusOuterEditorAcrossCardBoundary(
  outerEditor: LexicalEditor,
  nodeKey: string,
  direction: 1 | -1,
): boolean {
  let handled = false;
  outerEditor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (!node) return;
    const sibling = direction === 1 ? node.getNextSibling() : node.getPreviousSibling();
    if (sibling) {
      if (!$isElementNode(sibling)) return; // some other decorator — leave unhandled
      focusEdge(sibling, direction);
      handled = true;
      return;
    }
    const blank = $createParagraphNode();
    if (direction === 1) node.insertAfter(blank);
    else node.insertBefore(blank);
    blank.selectStart();
    handled = true;
  });
  return handled;
}

function focusEdge(element: ElementNode, direction: 1 | -1): void {
  if (direction === 1) element.selectStart();
  else element.selectEnd();
}

/** Looks up a specific card's already-registered nested-editor member by
 * its own directive node key — used by `CardDirectiveArrowPlugin.tsx`.
 * Returns `null` (a graceful no-op, falling through to the browser's
 * default jump-past-the-decorator behavior) if the card's nested editor
 * hasn't mounted yet — a narrow, rare race only possible immediately
 * after inserting a brand-new card before its content resolves. */
export function getCardEditorMember(
  outerEditor: LexicalEditor,
  nodeKey: string,
): OxEditorGroupMember | null {
  return getRegistry(outerEditor).get(nodeKey) ?? null;
}
