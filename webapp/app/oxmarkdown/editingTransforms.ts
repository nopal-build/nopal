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
import { $createListNode, $createListItemNode, $isListNode, $isListItemNode } from "@lexical/list";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
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
import { getFrontmatterNode, type OxDocument } from "./document";
import { $createOxDirectiveNode, $createOxOpaqueNode, $isOxDirectiveNode, $isOxOpaqueNode } from "./editingNodes";

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
  const lexicalNodes = bodyChildren
    .map((c) => convertBlock(c, defsByIdentifier))
    .filter((n): n is LexicalNode => n != null);

  return { lexicalNodes, aside: { frontmatter, definitions } };
}

type DefMap = Map<string, Definition>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertBlock(node: any, defs: DefMap): LexicalNode | null {
  switch (node.type) {
    case "paragraph":
      return $createParagraphNode().append(...convertInline(node.children, defs));

    case "heading": {
      const tag = `h${Math.min(Math.max(node.depth, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return $createHeadingNode(tag).append(...convertInline(node.children, defs));
    }

    case "blockquote": {
      const quote = $createQuoteNode();
      for (const child of node.children) {
        const converted = convertBlock(child, defs);
        if (converted) quote.append(converted);
      }
      return quote;
    }

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

function convertList(node: MdastList, defs: DefMap) {
  const isTaskList = node.children.some((c) => c.checked != null);
  const listType = node.ordered ? "number" : isTaskList ? "check" : "bullet";
  const list = $createListNode(listType, node.ordered ? node.start ?? 1 : 1);
  for (const item of node.children) {
    list.append(convertListItem(item, defs));
  }
  return list;
}

function convertListItem(node: MdastListItem, defs: DefMap) {
  const li = $createListItemNode(node.checked ?? undefined);
  const [first, ...rest] = node.children;
  if (first) {
    if (first.type === "paragraph") {
      li.append(...convertInline(first.children, defs));
    } else {
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

// ── Export: Lexical -> mdast ────────────────────────────────────────────────

export function exportOxDocument(root: RootNode, aside: AsideContent): OxDocument {
  const body = root
    .getChildren()
    .map((n) => exportBlock(n))
    .filter((n): n is BlockContent => n != null);
  return {
    type: "root",
    children: [
      ...(aside.frontmatter ? [aside.frontmatter] : []),
      ...body,
      ...aside.definitions,
    ],
  };
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
      children: node
        .getChildren()
        .map((c) => exportBlock(c))
        .filter(Boolean),
    };
  }
  if ($isListNode(node)) {
    return {
      type: "list",
      ordered: node.getListType() === "number",
      start: node.getListType() === "number" ? node.getStart() : null,
      spread: false,
      children: node.getChildren().map((li) => exportListItem(li)),
    };
  }
  if ($isElementNode(node) && !node.isInline()) {
    // Plain paragraph (also the fallback shape for anything ElementNode-like
    // we don't special-case above — safer than dropping it).
    return { type: "paragraph", children: exportInline(node.getChildren()) };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportListItem(li: any): MdastListItem {
  const checked = li.getChecked() ?? null;
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
  if (inlineChildren.length > 0) {
    itemChildren.push({ type: "paragraph", children: exportInline(inlineChildren) } as BlockContent);
  }
  for (const block of blockChildren) {
    const exported = exportBlock(block);
    if (exported) itemChildren.push(exported);
  }
  return { type: "listItem", checked, spread: false, children: itemChildren };
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
