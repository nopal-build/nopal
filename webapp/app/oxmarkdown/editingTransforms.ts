/**
 * The mdast <-> Lexical bridge for OxEditor's Editing mode.
 *
 * Deliberately NOT `@lexical/markdown`'s `$convertFromMarkdownString`/
 * `$convertToMarkdownString` — those parse/serialize markdown with
 * Lexical's own bundled parser, a second, different implementation from
 * `oxmarkdown/document.ts`'s real mdast pipeline. Build plan step 4 is
 * explicit that Editing mode must reuse the SAME document model as step 1,
 * not fork it — so this module only ever talks to real Lexical NODES
 * (`$createParagraphNode`, etc.), converting them to/from the exact mdast
 * shape `parseOxDocument`/`serializeOxDocument` already use. `@lexical/
 * markdown`'s `TRANSFORMERS` are still used elsewhere (see `OxEditor.tsx`),
 * but only for their live "typing `**x**` formats it as bold" convenience
 * — that only ever touches Lexical's own node tree (TextNode format bits,
 * HeadingNode, ListNode), which this module has to handle regardless of
 * whether a node was typed by hand or produced by a shortcut.
 *
 * Frontmatter and link/image *definitions* (the `[label]: url` lines GFM
 * reference-style links point at) are intentionally NOT converted to
 * Lexical nodes at all — Editing mode doesn't offer any UI to edit them yet,
 * so the safest thing is to hold them aside untouched (see `AsideContent`)
 * and splice them back in verbatim on export, rather than risk mangling
 * them through a round-trip with no real editing support behind it.
 * Reference-style links/images ARE resolved to concrete `link`/`image`
 * content at import time (so they're visible and editable like any other
 * link), which is why the *nodes that reference them* still work even
 * though the definitions themselves are frozen.
 */

import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type LexicalNode,
  type RootNode,
  type TextFormatType,
  type TextNode,
} from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { $createListNode, $isListNode, $isListItemNode } from "@lexical/list";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import type { Join } from "mdast-util-to-markdown";
import type {
  BlockContent,
  Definition,
  DefinitionContent,
  List as MdastList,
  ListItem as MdastListItem,
  PhrasingContent,
  RootContent,
  Yaml,
} from "mdast";
import { countBlankLines, getFrontmatterNode, type OxDocument } from "./document";
import {
  $createOxDirectiveNode,
  $createOxOpaqueNode,
  $isOxDirectiveNode,
  $isOxOpaqueNode,
} from "./editingNodes";
import { $createOxListItemNode, $isOxListItemNode, type OxListItemNode } from "./OxListItemNode";

// ── Import: mdast -> Lexical ────────────────────────────────────────────────

export interface AsideContent {
  frontmatter: Yaml | null;
  definitions: Definition[];
}

export interface ImportResult {
  lexicalNodes: LexicalNode[];
  aside: AsideContent;
}

export function importOxDocument(doc: OxDocument): ImportResult {
  const frontmatter = getFrontmatterNode(doc);
  const definitions: Definition[] = [];
  const defsByIdentifier = new Map<string, Definition>();
  for (const child of doc.children) {
    if (child.type === "definition") {
      definitions.push(child);
      defsByIdentifier.set(child.identifier, child);
    }
  }

  const bodyChildren = doc.children.filter(
    (c) => c.type !== "yaml" && c.type !== "definition",
  );
  const lexicalNodes = convertBlockList(bodyChildren, defsByIdentifier);

  return { lexicalNodes, aside: { frontmatter, definitions } };
}

type DefMap = Map<string, Definition>;

/** Converts a BLOCK-level sibling list, inserting one ordinary, empty
 * `ParagraphNode` per blank line in the source (`countBlankLines`) between
 * two blocks — NOT a custom decorator node (see `editingNodes.tsx`'s header
 * for why: an empty paragraph gets 100% standard Lexical editing behavior
 * for free — clickable, focusable, Backspace/Enter/arrows/undo all just
 * work — and "1 markdown line = 1 editor line" wants blank lines to be
 * real, ordinary rows anyway, not a decorative spacer). Used for root-level
 * content and any other block-level children list (a blockquote's, ...). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertBlockList(nodes: readonly any[], defs: DefMap): LexicalNode[] {
  const out: LexicalNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) {
      const blanks = countBlankLines(nodes[i - 1], nodes[i]);
      for (let b = 0; b < blanks; b++) out.push($createParagraphNode());
    }
    const converted = convertBlock(nodes[i], defs);
    if (converted) out.push(converted);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertBlock(node: any, defs: DefMap): LexicalNode | null {
  switch (node.type) {
    case "paragraph":
      return $createParagraphNode().append(...convertInline(node.children, defs));

    case "heading": {
      const tag = `h${Math.min(Math.max(node.depth, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return $createHeadingNode(tag).append(...convertInline(node.children, defs));
    }

    case "blockquote":
      return $createQuoteNode().append(...convertBlockList(node.children, defs));

    case "code": {
      const code = $createCodeNode(node.lang ?? undefined);
      if (node.value) code.append($createTextNode(node.value));
      return code;
    }

    case "thematicBreak":
      return $createHorizontalRuleNode();

    case "list":
      return convertList(node, defs);

    // Unsupported for now (no rich UI yet): tables, raw HTML blocks, and
    // anything else this bridge doesn't recognize. Kept as a lossless
    // passthrough rather than dropped — see `editingNodes.ts`'s header.
    case "table":
    case "html":
      return $createOxOpaqueNode(node, "block");

    case "leafDirective":
    case "containerDirective":
      return $createOxDirectiveNode(node);

    default:
      return $createOxOpaqueNode(node, "block");
  }
}

/** GFM cannot serialize `[ ]`/`[x]` for a list item with literally no
 * text at all (confirmed directly against `mdast-util-gfm-task-list-
 * item`'s source) — its checkbox injection needs a real paragraph child,
 * and the underlying parser separately requires real, non-whitespace
 * content after the checkbox to even recognize one on the way back in.
 * A lone zero-width space satisfies both without being visible to anyone
 * reading the file (confirmed directly: `- [ ] \u200b` round-trips through
 * parse -> serialize -> reparse byte-for-byte stable). `exportListItem`
 * injects this ONLY when an item has a real checkbox but no real text;
 * `convertListItem` recognizes and strips it back out on the way in, so
 * it never becomes real, persistent, or typeable content in the live
 * document — the placeholder exists purely in the serialized text. */
const CHECKBOX_PLACEHOLDER = "\u200b";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCheckboxPlaceholderParagraph(node: any): boolean {
  const children = node?.children ?? [];
  return children.length === 1 && children[0]?.type === "text" && children[0]?.value === CHECKBOX_PLACEHOLDER;
}

function convertList(node: MdastList, defs: DefMap) {
  // Never `"check"` — see `OxListItemNode.ts`'s header. Whether an
  // individual ITEM has a checkbox is `OxListItemNode`'s own field,
  // entirely independent of the list's type, so a checklist and a plain
  // bullet list are structurally identical here; only the items differ.
  const listType = node.ordered ? "number" : "bullet";
  const list = $createListNode(listType, node.ordered ? node.start ?? 1 : 1);
  for (const item of node.children) {
    list.append(convertListItem(item, defs));
  }
  return list;
}

function convertListItem(node: MdastListItem, defs: DefMap) {
  const li = $createOxListItemNode(node.checked ?? undefined);
  const [first, ...rest] = node.children;
  if (first) {
    // A lone `CHECKBOX_PLACEHOLDER` paragraph is `exportListItem`'s own
    // synthetic stand-in for "empty, but GFM needed SOME content to keep
    // the checkbox" — recognized and stripped back out here so it never
    // becomes real, visible, or typeable content in the live document.
    if (first.type === "paragraph" && !isCheckboxPlaceholderParagraph(first)) {
      li.append(...convertInline(first.children, defs));
    } else if (first.type !== "paragraph") {
      const converted = convertBlock(first, defs);
      if (converted) li.append(converted);
    }
  }
  for (const r of rest) {
    const converted = convertBlock(r, defs);
    if (converted) li.append(converted);
  }
  return li;
}

/** Flattens mdast's nested mark wrappers (`strong` containing `emphasis`
 * containing `text`, ...) into Lexical's flat-bitmask `TextNode`s, which
 * have no wrapper nodes of their own — a mark is just a bit on the leaf. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertInline(
  nodes: any[],
  defs: DefMap,
  marks: readonly TextFormatType[] = [],
): LexicalNode[] {
  const out: LexicalNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(applyMarks($createTextNode(node.value), marks));
        break;
      case "strong":
        out.push(...convertInline(node.children, defs, [...marks, "bold"]));
        break;
      case "emphasis":
        out.push(...convertInline(node.children, defs, [...marks, "italic"]));
        break;
      case "delete":
        out.push(...convertInline(node.children, defs, [...marks, "strikethrough"]));
        break;
      case "inlineCode":
        out.push(applyMarks($createTextNode(node.value), [...marks, "code"]));
        break;
      case "break":
        out.push($createLineBreakNode());
        break;
      case "link": {
        const link = $createLinkNode(node.url, { title: node.title ?? undefined });
        link.append(...convertInline(node.children, defs, marks));
        out.push(link);
        break;
      }
      case "linkReference": {
        const def = defs.get(node.identifier);
        if (!def) break; // unresolved — dropped, matches OxRenderer's static behavior
        const link = $createLinkNode(def.url, { title: def.title ?? undefined });
        link.append(...convertInline(node.children, defs, marks));
        out.push(link);
        break;
      }
      case "image":
        out.push($createOxOpaqueNode(node, "inline"));
        break;
      case "imageReference": {
        const def = defs.get(node.identifier);
        if (!def) break;
        out.push(
          $createOxOpaqueNode(
            { type: "image", url: def.url, alt: node.alt ?? null, title: def.title ?? null },
            "inline",
          ),
        );
        break;
      }
      case "textDirective":
        out.push($createOxDirectiveNode(node));
        break;
      case "html":
        out.push($createOxOpaqueNode(node, "inline"));
        break;
      default:
        out.push($createOxOpaqueNode(node, "inline"));
    }
  }
  return out;
}

function applyMarks(textNode: TextNode, marks: readonly TextFormatType[]): TextNode {
  let node = textNode;
  for (const mark of marks) node = node.toggleFormat(mark);
  return node;
}

// ── Export: Lexical -> mdast ──────────────────────────────────────────
// A blank line is just an ordinary, empty `ParagraphNode` on the Lexical
// side (see `editingNodes.tsx`'s header) — it's exported like any other
// paragraph, via the SAME generic fallback below, no special-casing
// needed. The one thing that DOES need help: `mdast-util-to-markdown`
// gives every block-level sibling pair its own default one-blank-line
// join UNLESS told otherwise — which would add an extra, unwanted blank
// line on top of the one an empty paragraph already represents just by
// existing in the flow. `blankLineJoin` (passed to `serializeOxDocument`)
// forces that default off specifically around empty paragraphs; every
// other pair is untouched. Confirmed directly, not assumed: N consecutive
// empty paragraphs with the surrounding joins forced to 0 serialize to
// exactly N blank lines, not the 2K+1 an earlier, less careful attempt at
// this produced (see the oxmarkdown skill's TODO 10 for that history).

export interface ExportResult {
  doc: OxDocument;
  join: Join;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isBlankLineNode(node: any): boolean {
  return node?.type === "paragraph" && (!node.children || node.children.length === 0);
}

const blankLineJoin: Join = (left, right) => {
  if (isBlankLineNode(left) || isBlankLineNode(right)) return 0;
  return undefined; // no opinion — defer to the library's own default (one blank line)
};

export function exportOxDocument(root: RootNode, aside: AsideContent): ExportResult {
  const body = exportBlockList(root.getChildren());
  const doc: OxDocument = {
    type: "root",
    children: [
      ...(aside.frontmatter ? [aside.frontmatter] : []),
      ...body,
      ...aside.definitions,
    ],
  };
  return { doc, join: blankLineJoin };
}

/** Exports a BLOCK-level sibling list. Used for root-level content and any
 * other block-level children list (a blockquote's, ...), mirroring
 * `convertBlockList` on the import side. */
function exportBlockList(nodes: LexicalNode[]): BlockContent[] {
  const out: BlockContent[] = [];
  for (const node of nodes) {
    const exported = exportBlock(node);
    if (exported) out.push(exported);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportBlock(node: LexicalNode): any {
  if ($isOxDirectiveNode(node) && !node.isInline()) return node.getMdastNode();
  if ($isOxOpaqueNode(node) && !node.isInline()) return node.getMdastNode();
  if ($isHorizontalRuleNode(node)) return { type: "thematicBreak" };
  if ($isCodeNode(node)) {
    return { type: "code", lang: node.getLanguage() ?? null, meta: null, value: node.getTextContent() };
  }
  if ($isHeadingNode(node)) {
    return {
      type: "heading",
      depth: Number(node.getTag().slice(1)),
      children: exportInline(node.getChildren()),
    };
  }
  if ($isQuoteNode(node)) {
    return {
      type: "blockquote",
      children: exportBlockList(node.getChildren()),
    };
  }
  if ($isListNode(node)) {
    return {
      type: "list",
      ordered: node.getListType() === "number",
      start: node.getListType() === "number" ? node.getStart() : null,
      spread: false,
      children: node.getChildren().filter($isOxListItemNode).map((li) => exportListItem(li)),
    };
  }
  if ($isElementNode(node) && !node.isInline()) {
    // Plain paragraph (also the fallback shape for anything ElementNode-like
    // we don't special-case above — safer than dropping it). An EMPTY one
    // (no children) is exactly a blank line — see this section's header.
    return { type: "paragraph", children: exportInline(node.getChildren()) };
  }
  return null;
}

/** `checked` is `null` (not exported as a checkbox at all) unless
 * `isRealCheckbox()` says so — the SAME predicate rendering uses
 * (`OxListItemNode.ts`), so the exported markdown and the rendered glyph
 * can never disagree about whether a given item has a checkbox, in
 * either direction: an item with no checkbox never gets `[ ]`/`[x]`
 * conjured up, and one WITH a checkbox always gets it, even with no real
 * text (via `CHECKBOX_PLACEHOLDER`, above), so the render is never
 * showing something the file can't actually contain. */
function exportListItem(li: OxListItemNode): MdastListItem {
  const hasCheckbox = li.isRealCheckbox();
  const children = li.getChildren() as LexicalNode[];
  const inlineChildren: LexicalNode[] = [];
  const blockChildren: LexicalNode[] = [];
  for (const child of children) {
    if ($isListNode(child) || (($isElementNode(child) && !child.isInline()) && !$isListItemNode(child))) {
      blockChildren.push(child);
    } else {
      inlineChildren.push(child);
    }
  }
  const itemChildren: (BlockContent | DefinitionContent)[] = [];
  const exportedInline = exportInline(inlineChildren);
  if (exportedInline.length > 0) {
    itemChildren.push({ type: "paragraph", children: exportedInline } as BlockContent);
  } else if (hasCheckbox) {
    itemChildren.push({
      type: "paragraph",
      children: [{ type: "text", value: CHECKBOX_PLACEHOLDER }],
    } as BlockContent);
  }
  for (const block of blockChildren) {
    const exported = exportBlock(block);
    if (exported) itemChildren.push(exported);
  }
  return { type: "listItem", checked: hasCheckbox ? (li.getChecked() as boolean) : null, spread: false, children: itemChildren };
}

function exportInline(nodes: LexicalNode[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if ($isLineBreakNode(node)) {
      out.push({ type: "break" });
    } else if ($isLinkNode(node)) {
      out.push({
        type: "link",
        url: node.getURL(),
        title: node.getTitle() ?? null,
        children: exportInline(node.getChildren()),
      });
    } else if ($isOxDirectiveNode(node) && node.isInline()) {
      out.push(node.getMdastNode() as PhrasingContent);
    } else if ($isOxOpaqueNode(node) && node.isInline()) {
      out.push(node.getMdastNode() as PhrasingContent);
    } else if ($isTextNode(node)) {
      out.push(wrapMarks(node));
    }
  }
  return out;
}

function wrapMarks(node: TextNode): PhrasingContent {
  const text = node.getTextContent();
  if (node.hasFormat("code")) return { type: "inlineCode", value: text };
  let inner: PhrasingContent = { type: "text", value: text };
  if (node.hasFormat("strikethrough")) inner = { type: "delete", children: [inner] };
  if (node.hasFormat("italic")) inner = { type: "emphasis", children: [inner] };
  if (node.hasFormat("bold")) inner = { type: "strong", children: [inner] };
  return inner;
}
