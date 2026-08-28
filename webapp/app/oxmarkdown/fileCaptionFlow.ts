/**
 * Lets ArrowDown/ArrowUp flow between SIBLING `::file{...}` directives'
 * caption editors within the SAME outer document — e.g. a card with three
 * consecutive photos: ArrowDown out of the first caption lands in the
 * second's, and so on, treating a run of file directives like one
 * continuous column even though each caption is its own independent
 * Lexical editor instance.
 *
 * Deliberately NOT built on `oxmarkdown/OxEditorGroup.tsx` — that
 * mechanism assumes members are a flat, EXTERNALLY-supplied `order` (the
 * caller already knows the sequence, e.g. a day's cards). Here the
 * "members" are decorator nodes living INSIDE one outer editor's own
 * Lexical tree, whose relative order is already fully determined by that
 * tree itself — so instead of an external order array, this walks the
 * OUTER editor's tree directly (`findSiblingFileDirectiveKey`) to find
 * the next/previous file directive, skipping over blank-line paragraphs
 * but stopping at any other real content (so this only ever connects a
 * genuinely CONSECUTIVE run of files, not every file anywhere in the
 * document).
 *
 * Each caption registers itself (by its OWN directive's node key) into a
 * registry scoped to its outer editor instance — a plain `WeakMap` keyed
 * by the outer `LexicalEditor`, not a React context, since the only
 * things that need to reach it (`FileCaptionArrowPlugin`) already have a
 * direct reference to that outer editor passed down explicitly (see
 * `editingNodes.tsx`), with no separate provider needed.
 *
 * ALSO handles the two edges `focusSiblingFileCaption` explicitly leaves
 * alone above — entering the caption stack from the surrounding OUTER
 * prose, and exiting back into it — via `focusOuterEditorAcrossBoundary`,
 * below. Between the two, a caption's ArrowUp/ArrowDown at its own true
 * start/end always lands SOMEWHERE sensible in the outer document: a
 * sibling caption if one is consecutively adjacent, otherwise the nearest
 * real content (a paragraph, heading, list, ...) immediately before/after
 * the file directive in the outer tree, or — if there's truly nothing
 * there at all — a freshly created blank paragraph to land in, rather
 * than falling through to Lexical's own default decorator-adjacency
 * behavior (silently jumping PAST the whole decorator). The one case
 * deliberately left unhandled: the adjacent outer sibling is some OTHER
 * kind of block decorator (not a file directive — that's already caught
 * by `focusSiblingFileCaption` — e.g. a table). That's rare enough, and
 * decorator-to-decorator caret placement ambiguous enough, that it isn't
 * worth solving here; the old jump-past behavior applies there instead. */

import {
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  $isParagraphNode,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { $isOxDirectiveNode } from "./editingNodes";
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

/** Called on mount/unmount by `FileCaptionArrowPlugin`. */
export function registerFileCaption(
  outerEditor: LexicalEditor,
  nodeKey: string,
  member: OxEditorGroupMember,
): () => void {
  const registry = getRegistry(outerEditor);
  registry.set(nodeKey, member);
  return () => registry.delete(nodeKey);
}

function findSiblingFileDirectiveKey(
  outerEditor: LexicalEditor,
  nodeKey: string,
  direction: 1 | -1,
): string | null {
  return outerEditor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    if (!node) return null;
    let sibling = direction === 1 ? node.getNextSibling() : node.getPreviousSibling();
    while (sibling) {
      if ($isOxDirectiveNode(sibling) && sibling.getMdastNode().name === "file") {
        return sibling.getKey();
      }
      // An ordinary blank-line paragraph doesn't break the "consecutive
      // run of files" chain — anything else (real prose, a list, ...)
      // does, per this file's header.
      if (!($isParagraphNode(sibling) && sibling.getChildrenSize() === 0)) return null;
      sibling = direction === 1 ? sibling.getNextSibling() : sibling.getPreviousSibling();
    }
    return null;
  });
}

/** Returns `true` if a sibling caption was found and focused (so the
 * caller knows whether to treat the key as handled). */
export function focusSiblingFileCaption(
  outerEditor: LexicalEditor,
  nodeKey: string,
  direction: 1 | -1,
): boolean {
  const siblingKey = findSiblingFileDirectiveKey(outerEditor, nodeKey, direction);
  if (!siblingKey) return false;
  const member = getRegistry(outerEditor).get(siblingKey);
  if (!member) return false;
  if (direction === 1) member.focusStart();
  else member.focusEnd();
  return true;
}

/** Looks up a specific file directive's already-registered caption
 * member directly, by its own node key — used by `fileDirective.ts` to
 * focus a just-inserted file's caption once it's actually mounted (see
 * `focusFileCaptionOnceMounted` there for why this needs to be polled
 * rather than called once, right after insertion). */
export function getFileCaptionMember(
  outerEditor: LexicalEditor,
  nodeKey: string,
): OxEditorGroupMember | null {
  return getRegistry(outerEditor).get(nodeKey) ?? null;
}

/** Lands the caret in the OUTER editor's own content immediately before
 * (`direction: -1`) or after (`direction: 1`) the file directive
 * `nodeKey` — the fallback `FileCaptionArrowPlugin` uses once
 * `focusSiblingFileCaption` has already ruled out a consecutively
 * adjacent file caption. Also used directly by the caption's own
 * double-Enter "escape" gesture (always `direction: 1`, from
 * `FileCaptionArrowPlugin`'s Enter handling) — landing "in the nearest
 * real content after the image, creating a blank line if there isn't
 * any yet" is the exact same operation either way.
 *
 * - If a real sibling element (paragraph, heading, list, ...) already
 *   sits there, the caret lands inside it — at its START when arriving
 *   from above (`direction: 1`), or its END when arriving from below
 *   (`direction: -1`) — mirroring `CrossEditorArrowPlugin`'s own
 *   `focusStart`/`focusEnd` convention for entering a neighbor.
 * - If there's truly nothing there (the true edge of the outer
 *   document), a fresh blank paragraph is created and focused instead of
 *   leaving nowhere to go — the ArrowUp-at-the-very-first-row case is
 *   normally already prevented from ever occurring by
 *   `LeadingBlockGuardPlugin` (a leading block decorator always gets a
 *   paragraph spliced in ahead of it), so this mainly matters for
 *   ArrowDown/double-Enter past the LAST row, which has no such
 *   standing guarantee.
 * - If the adjacent sibling is some other kind of block decorator (not a
 *   file directive — `focusSiblingFileCaption` already handles that
 *   case before this function is ever reached), this returns `false` and
 *   does nothing, leaving Lexical's own default jump-past-the-decorator
 *   behavior to apply — see this file's header. */
export function focusOuterEditorAcrossBoundary(
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

