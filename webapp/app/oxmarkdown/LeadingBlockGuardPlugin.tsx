/**
 * Enforces a general invariant for every Editing-mode `OxEditor`: a
 * block-level decorator (a `::file{...}` directive today; any future
 * block-level interactable — `::card{...}`, a table via `OxOpaqueNode`,
 * etc. — for free) OR a Toggle List (`OxToggleNode` — see
 * `OxToggleNode.ts`) can never be the FIRST child of the document. A
 * Toggle List isn't a decorator at all (it's a real `ElementNode`
 * container, precisely so its body gets ordinary Lexical editing for
 * free — see that file's header), so it needs its own explicit check
 * here rather than falling out of the `$isDecoratorNode` test below.
 *
 * Why: a block decorator can't itself be arrow-key'd "into" from above —
 * there's nothing above it to arrow down FROM. Guaranteeing a real,
 * clickable paragraph always precedes it means a human can always arrow
 * up (or click) to place content before it, and `fileCaptionFlow.ts`'s
 * cross-editor ArrowUp can always assume a landing spot exists one level
 * up, instead of needing its own separate "there's truly nothing here,
 * fabricate a paragraph on the fly" fallback for this specific case (it
 * still has one anyway, defensively — see that file — but this is what
 * makes it a rare/theoretical path rather than the common one).
 *
 * Implemented as a `RootNode` transform, same pattern as `MinRowsPlugin`
 * — transforms automatically re-run whenever the root's children change
 * (including on initial load, since `registerNodeTransform` marks every
 * existing node of that type dirty the moment it's registered), so a
 * document that ALREADY starts with a block decorator (loaded from
 * markdown, pasted, undone into that state, ...) gets a leading paragraph
 * spliced in immediately, not just newly-inserted ones.
 *
 * Deliberately does NOT trim a leading blank paragraph back out once
 * later edits would make it removable (e.g. the decorator gets deleted) —
 * that's just an ordinary empty row at that point, no different from any
 * other blank line a human might have typed, and `exportOxDocument` only
 * ever trims TRAILING blank paragraphs, never interior ones (see
 * `editingTransforms.ts`) — consistent with treating this as a normal
 * row once inserted, not a special marker to clean up later.
 */

import { useEffect } from "react";
import { $createParagraphNode, $isDecoratorNode, RootNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isOxToggleNode } from "./OxToggleNode";

export default function LeadingBlockGuardPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(RootNode, (root) => {
      const first = root.getFirstChild();
      const isGuardedBlock =
        first && (($isDecoratorNode(first) && !first.isInline()) || $isOxToggleNode(first));
      if (isGuardedBlock) {
        first.insertBefore($createParagraphNode());
      }
    });
  }, [editor]);

  return null;
}
