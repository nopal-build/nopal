/**
 * Live-typing shortcut for Toggle Lists: typing `> ` at the start of a
 * fresh top-level paragraph converts it into a real `OxToggleNode` — see
 * `OxToggleNode.ts`'s header for the markdown shape and why it's a real
 * container node, not a directive/decorator.
 *
 * `> ` is deliberately repurposed FROM blockquotes for this (blockquotes
 * moved to `"` — see `quoteTransformer.ts`), matching Notion's own
 * mnemonic for a toggle. Modeled directly on `@lexical/markdown`'s
 * `QUOTE` transformer's OWN shape (read from `LexicalMarkdown.dev.mjs`)
 * — same `regExp`/`replace(parentNode, children, match, isImport)`
 * contract, just building a toggle instead of a blockquote: whatever was
 * already typed on the line becomes the toggle's title (its
 * `OxToggleSummaryNode`), and a single empty paragraph is created as the
 * toggle's initial body — the same "always a real clickable row"
 * invariant `convertToggle` (`editingTransforms.ts`) enforces on import
 * from saved markdown.
 */

import type { ElementTransformer } from "@lexical/markdown";
import { $createParagraphNode, type LexicalNode } from "lexical";
import {
  $createOxToggleNode,
  $createOxToggleSummaryNode,
  OxToggleNode,
  OxToggleSummaryNode,
} from "./OxToggleNode";

const TOGGLE_REGEX = /^>\s/;

export const OX_TOGGLE: ElementTransformer = {
  dependencies: [OxToggleNode, OxToggleSummaryNode],
  // Never actually called on export — see `checklistTransformer.ts`'s
  // header for why (this codebase's real export path is
  // `exportOxDocument`, not `@lexical/markdown`'s own serializer).
  export: () => null,
  regExp: TOGGLE_REGEX,
  type: "element",
  replace(parentNode, children, _match, isImport) {
    const summary = $createOxToggleSummaryNode().append(...(children as LexicalNode[]));
    const toggle = $createOxToggleNode(false).append(summary, $createParagraphNode());
    parentNode.replace(toggle);
    if (!isImport) summary.select(0, 0);
  },
};
