/**
 * Live-typing shortcut for blockquotes: typing `" ` (a literal double
 * quote, then a space) at the start of a fresh top-level paragraph
 * converts it into a real blockquote — the SAME conversion
 * `@lexical/markdown`'s own default `QUOTE` transformer does, just keyed
 * off a different trigger character.
 *
 * `> ` was deliberately moved OFF blockquotes and onto the new Toggle
 * List instead (`toggleTransformer.ts`) — a product decision, not a
 * limitation: `>` reads more like Notion's own toggle shortcut once a
 * toggle exists as a primitive, and `"` (starting a quotation) is at
 * least as natural a mnemonic for "blockquote" as `>` ever was. Copied
 * from `@lexical/markdown`'s own `QUOTE` (read directly from
 * `LexicalMarkdown.dev.mjs`, not guessed) rather than importing and
 * patching its `regExp` in place, since `ElementTransformer.regExp` isn't
 * writable on the shared, already-frozen default export.
 */

import type { ElementTransformer } from "@lexical/markdown";
import { $createLineBreakNode, type LexicalNode } from "lexical";
import { $createQuoteNode, $isQuoteNode, QuoteNode } from "@lexical/rich-text";

const QUOTE_REGEX = /^"\s/;

export const OX_QUOTE: ElementTransformer = {
  dependencies: [QuoteNode],
  // Never actually called — see `checklistTransformer.ts`'s header for why
  // (this codebase's real export path is `exportOxDocument`, not
  // `@lexical/markdown`'s own serializer).
  export: () => null,
  regExp: QUOTE_REGEX,
  type: "element",
  replace(parentNode, children, _match, isImport) {
    if (isImport) {
      const previousNode = parentNode.getPreviousSibling();
      if ($isQuoteNode(previousNode)) {
        previousNode.append($createLineBreakNode(), ...(children as LexicalNode[]));
        parentNode.remove();
        return;
      }
    }
    const node = $createQuoteNode();
    node.append(...(children as LexicalNode[]));
    parentNode.replace(node);
    if (!isImport) node.select(0, 0);
  },
};

