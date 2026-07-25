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
 * Scope note: this only connects captions to EACH OTHER. Entering the
 * first caption from the surrounding prose above it, or exiting the last
 * caption back into the prose below it, isn't handled here — Lexical's
 * own default decorator-adjacency behavior (jumping PAST a block
 * decorator entirely) still applies at those two edges.
 */

import { $getNodeByKey, $isParagraphNode, type LexicalEditor } from "lexical";
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

