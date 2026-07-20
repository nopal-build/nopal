/**
 * Live-typing shortcut for checkboxes: typing `[ ] ` or `[x] ` (optionally
 * preceded by `- `) at the start of a fresh top-level paragraph converts it
 * into a real `OxListItemNode` checkbox, the same as typing `# ` live-
 * converts into a heading.
 *
 * Modeled directly on `@lexical/markdown`'s own `CHECK_LIST` transformer
 * (`listReplace('check')`, read from `LexicalMarkdown.dev.mjs`) but NOT
 * reusing it directly — that transformer creates a native `"check"`-type
 * `ListNode`, which this codebase never uses at all (see
 * `OxListItemNode.ts`'s header for why: checkbox-ness is the ITEM's own
 * field, decoupled from the list's type, specifically so one `<ul>` can
 * freely mix checkbox and plain-bullet items). Reusing `CHECK_LIST.regExp`
 * directly, though — no reason to hand-copy that pattern, and it stays in
 * sync with upstream automatically.
 *
 * Scope, matching a real, confirmed limitation of the underlying mechanism
 * (`registerMarkdownShortcuts` in `@lexical/markdown`), not something this
 * file introduces: an `ElementTransformer` only ever fires for a text node
 * whose PARENT's parent is the root (see that function's
 * `$isRootOrShadowRoot(grandParentNode)` check) — i.e. only a fresh,
 * top-level paragraph, never text typed inside an already-open list item.
 * Also, because transforms run per-keystroke on whatever regex matches the
 * text ending at the just-typed space, typing the full sequence `- [ ] `
 * character by character converts to a PLAIN bullet after the second
 * character (`- `, matching `UNORDERED_LIST`'s regex) before `[ ] ` is ever
 * reached — so live-typing conversion in practice only reaches a checkbox
 * when `[ ] `/`[x] ` is typed WITHOUT a leading dash (the regex's dash
 * prefix is optional for exactly this reason upstream). Typing `- [ ] `
 * (with the dash) still works for pasted content, via the separate
 * paste-handling plugin, which routes through the real mdast parser
 * instead of this per-keystroke mechanism.
 */

import { CHECK_LIST, type ElementTransformer } from "@lexical/markdown";
import { $createListNode, $isListNode, ListNode } from "@lexical/list";
import { $createOxListItemNode, OxListItemNode } from "./OxListItemNode";

// Amount of spaces that define one indent level — matches
// `@lexical/markdown`'s own (unexported) constant exactly, for consistent
// indent handling between this transformer and the built-in list ones.
const LIST_INDENT_SIZE = 4;

function getIndent(whitespace: string): number {
  const tabs = whitespace.match(/\t/g);
  const spaces = whitespace.match(/ /g);
  let indent = 0;
  if (tabs) indent += tabs.length;
  if (spaces) indent += Math.floor(spaces.length / LIST_INDENT_SIZE);
  return indent;
}

export const OX_CHECK_LIST: ElementTransformer = {
  dependencies: [ListNode, OxListItemNode],
  // Never actually called — this codebase's export path is
  // `exportOxDocument`/`serializeOxDocument` (real mdast), not
  // `@lexical/markdown`'s `$convertToMarkdownString`. Kept only to satisfy
  // `ElementTransformer`'s type contract.
  export: () => null,
  regExp: CHECK_LIST.regExp,
  type: "element",
  replace(parentNode, children, match, isImport) {
    const checked = (match[3] ?? "").toLowerCase() === "x";
    const listItem = $createOxListItemNode(checked);
    const previousNode = parentNode.getPreviousSibling();
    const nextNode = parentNode.getNextSibling();

    // Every list here is always "bullet"-typed (never "check") — see this
    // file's header — so merging into an adjacent list just needs to check
    // for ANY adjacent bullet list, unlike upstream's `listReplace`, which
    // also has to check the adjacent list's type matches the one being
    // inserted.
    if ($isListNode(nextNode) && nextNode.getListType() === "bullet") {
      const firstChild = nextNode.getFirstChild();
      if (firstChild !== null) firstChild.insertBefore(listItem);
      else nextNode.append(listItem);
      parentNode.remove();
    } else if ($isListNode(previousNode) && previousNode.getListType() === "bullet") {
      previousNode.append(listItem);
      parentNode.remove();
    } else {
      const list = $createListNode("bullet");
      list.append(listItem);
      parentNode.replace(list);
    }

    listItem.append(...children);
    if (!isImport) listItem.select(0, 0);
    const indent = getIndent(match[1]);
    if (indent) listItem.setIndent(indent);
  },
};
