/**
 * OxMarkdown → Typst markup — the pure half of the `oxmarkdown-pdf-via-
 * typst` worker effort (see the garden seed): turns a parsed `OxDocument`
 * into a `.typ` source string plus the list of vault images it references,
 * with zero I/O. The caller (`robustness-core`'s letter PDF job) resolves
 * each image's real bytes and writes them next to the `.typ` file before
 * handing it to the real `typst compile` binary — same "resolved
 * externally" split as `CardResolver`/`GalleryFolderResolver` elsewhere in
 * this package.
 *
 * Replaces printing a live page in headless Chromium
 * (`letterPdfRender.server.ts`) with typesetting the letter's own sent
 * markdown directly — no browser, no network round-trip, no public URL.
 *
 * V1 scope, by explicit product decision (2026-11-02): a letter's
 * `::video{...}`/`::LoadCellGraph{...}` directives can't be typeset (no
 * player, no chart) and print as a short italic placeholder line instead
 * of an error or a silent drop. A future version may turn each into a QR
 * code + URL (to the resource itself, or back to the letter) once this
 * package has a QR-generating dependency; V1 intentionally doesn't reach
 * for one. Any OTHER unrecognized directive, or raw HTML, renders as
 * nothing at all (same "skip, don't guess" rule `galleryDirective.ts`'s
 * resolvers already follow) rather than a loud error block — a letter's
 * PDF is best-effort paper, not the source of truth (the markdown
 * download next to it is).
 *
 * Typst markup is NOT CommonMark — bold/italic use a single delimiter
 * character (`*`/`_`, not `**`/`__`), strikethrough/highlight have no
 * shorthand at all (`#strike[..]`/`#highlight[..]`), and there is no
 * blockquote shorthand (`#quote(block: true)[..]`). Getting these wrong
 * is easy and silent (Typst just typesets the wrong thing, it doesn't
 * error) — see this package's own tests for a real `typst compile`
 * round-trip, not just "looks right".
 */

import type {
  Blockquote,
  Break,
  Code,
  Delete,
  Emphasis,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Text,
  ThematicBreak,
} from "mdast";
import { isDirectiveNode, type DirectiveNode, type OxDocument } from "./document";
import type { Mark } from "./highlightMark";

/** One image the rendered `.typ` source refers to by a placeholder file
 * name (e.g. `image-0.jpg`) — the caller must write that exact file,
 * normalized to JPEG (any format in, one format out, same convention
 * `heicToJpeg`/`attachmentFrames.server.ts` already uses for the model-
 * facing side of a photo), into the same directory as the `.typ` source
 * before compiling. Typst resolves `image()` paths relative to the
 * source file doing the calling. */
export type TypstImageRef = { placeholder: string; fileId: string };

export type TypstRenderResult = { typst: string; images: TypstImageRef[] };

/** `/api/vault/view/<id>` — the one literal shape a vault picture's
 * `url` takes in a letter's sent body (`publicBody.ts`'s own `VIEW_URL`).
 * A letter's images are never anything else: pasted/uploaded pictures
 * always go through the vault, there is no "paste an external image URL"
 * path in the editor. */
const VAULT_VIEW_URL = /^\/api\/vault\/view\/([A-Za-z0-9]+)(?:[?#].*)?$/;

/** Every ASCII punctuation character Typst markup gives special meaning
 * to somewhere (delimiters, shorthands, line-start markers) — escaped
 * unconditionally, everywhere, rather than only where each one happens
 * to be special. Over-escaping a character that didn't need it is a
 * no-op (Typst's own escape rule: a backslash before ANY character just
 * means that literal character); under-escaping silently typesets the
 * wrong thing. Covers both mid-text delimiters (`*_#$@~<>[]\``) and the
 * line-start ambiguity a text run can't otherwise avoid (a paragraph
 * that happens to start with "- " or "# " or "=" read as a list/heading
 * marker instead of plain text). */
const TYPST_ESCAPE_RE = /[\\*_#$@~<>[\]`\-+=/]/g;

export function escapeTypstText(value: string): string {
  return value.replace(TYPST_ESCAPE_RE, (c) => `\\${c}`);
}

/** Inside a Typst double-quoted string (a function call argument like
 * `link("...")` ) — only `\` and `"` need escaping; the text-mode
 * shorthand table above doesn't apply in code/string context. */
function escapeTypstString(value: string): string {
  return value.replace(/[\\"]/g, (c) => `\\${c}`);
}

function indentBlock(block: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/** A raw/code fence long enough that the content's own longest backtick
 * run can't prematurely close it — the same problem (and fix) as a
 * markdown fenced code block whose content itself contains ``` . */
function backtickFence(value: string, minLength: number): string {
  let longestRun = 0;
  for (const run of value.matchAll(/`+/g)) longestRun = Math.max(longestRun, run[0].length);
  return "`".repeat(Math.max(minLength, longestRun + 1));
}

function placeholderFor(fileId: string, images: TypstImageRef[]): string {
  const existing = images.find((i) => i.fileId === fileId);
  if (existing) return existing.placeholder;
  const placeholder = `image-${images.length}.jpg`;
  images.push({ placeholder, fileId });
  return placeholder;
}

/** A short, honest stand-in for a directive this renderer can't typeset
 * at all (no player, no chart) — printed in the body rather than
 * dropped silently, so a reader of the PAPER knows something is missing
 * and that the live letter has more. */
function directivePlaceholder(node: DirectiveNode): string | null {
  const name = node.name.toLowerCase();
  if (name === "video") return "_This letter includes a video — view it online to watch._";
  if (name === "loadcellgraph") return "_This letter includes a load-cell test graph — view it online to see the data._";
  return null;
}

function renderInlineNode(node: PhrasingContent, images: TypstImageRef[]): string {
  switch (node.type) {
    case "text":
      return escapeTypstText((node as Text).value);
    case "strong":
      return `*${renderInline((node as Strong).children, images)}*`;
    case "emphasis":
      return `_${renderInline((node as Emphasis).children, images)}_`;
    case "delete":
      return `#strike[${renderInline((node as Delete).children, images)}]`;
    case "mark":
      return `#highlight[${renderInline((node as Mark).children, images)}]`;
    case "inlineCode": {
      const value = (node as InlineCode).value;
      const fence = backtickFence(value, 1);
      return `${fence}${value}${fence}`;
    }
    case "link": {
      const link = node as Link;
      return `#link("${escapeTypstString(link.url)}")[${renderInline(link.children, images)}]`;
    }
    case "image": {
      const image = node as Image;
      const match = VAULT_VIEW_URL.exec(image.url);
      // Not a vault file (shouldn't happen for a letter — see the
      // module docstring — but render nothing rather than a broken
      // `image()` call pointed at a URL Typst can't fetch at compile
      // time).
      if (!match) return "";
      const placeholder = placeholderFor(match[1], images);
      return `#image("${placeholder}", width: 100%)`;
    }
    case "break":
      void (node as Break);
      return "\\\n";
    default:
      // textDirective (an inline-level directive, e.g. a stray
      // `::video{}` written mid-sentence rather than on its own line) —
      // same placeholder-or-skip rule as the block-level directives.
      if (isDirectiveNode(node)) return directivePlaceholder(node) ?? "";
      return "";
  }
}

function renderInline(nodes: PhrasingContent[], images: TypstImageRef[]): string {
  return nodes.map((n) => renderInlineNode(n, images)).join("");
}

function renderListItem(item: ListItem, ordered: boolean, images: TypstImageRef[]): string {
  const marker = ordered ? "+" : "-";
  // Literal brackets — a raw, unescaped `[`/`]` in Typst markup opens a
  // content block, so these are written already-escaped rather than
  // through `escapeTypstText` (which operates on markdown TEXT nodes'
  // values, not on strings this renderer builds itself).
  const checkbox = item.checked === true ? "\\[x\\] " : item.checked === false ? "\\[ \\] " : "";
  const blocks = item.children.map((child) => renderBlock(child, images)).filter((b) => b.length > 0);
  if (blocks.length === 0) return `${marker} ${checkbox}`.trimEnd();
  const [first, ...rest] = blocks;
  const firstLine = `${marker} ${checkbox}${first}`;
  if (rest.length === 0) return firstLine;
  // A list item's continuation content (a second paragraph, a nested
  // list) is indented under the marker so it stays part of the SAME
  // item instead of starting a new top-level block. A flat 2 spaces
  // (Typst's own minimum) rather than lining up under the marker's
  // exact visual width, which the checkbox's ESCAPED source length
  // (`\\[x\\] `, 6 characters for 4 visible ones) can't be used for.
  return [firstLine, ...rest.map((b) => indentBlock(b, 2))].join("\n\n");
}

function renderList(node: List, images: TypstImageRef[]): string {
  const ordered = node.ordered === true;
  // No blank line between items: Typst (like CommonMark) keeps adjacent
  // marker lines in the same list; a blank line between would still
  // normally continue a tight list, but staying consistent with no gap
  // at all removes any ambiguity for a loose one.
  return node.children.map((item) => renderListItem(item, ordered, images)).join("\n");
}

function renderBlock(node: RootContent, images: TypstImageRef[]): string {
  switch (node.type) {
    case "heading": {
      const heading = node as Heading;
      return `${"=".repeat(heading.depth)} ${renderInline(heading.children, images)}`;
    }
    case "paragraph":
      return renderInline((node as Paragraph).children, images);
    case "list":
      return renderList(node as List, images);
    case "blockquote": {
      const quote = node as Blockquote;
      return `#quote(block: true)[\n${renderBlocks(quote.children, images)}\n]`;
    }
    case "code": {
      const code = node as Code;
      const value = code.value ?? "";
      const fence = backtickFence(value, 3);
      return `${fence}${code.lang ?? ""}\n${value}\n${fence}`;
    }
    case "thematicBreak":
      void (node as ThematicBreak);
      return "#line(length: 100%)";
    case "yaml":
      // Front matter — never reaches here in practice (the caller
      // parses the letter's BODY, already split from its front matter
      // via `splitFrontmatter`), kept as an explicit no-op rather than
      // falling into "unknown" so a future caller that forgets to split
      // it first gets silence, not a YAML dump in the PDF.
      return "";
    default:
      if (isDirectiveNode(node as unknown as { type: string })) {
        return directivePlaceholder(node as unknown as DirectiveNode) ?? "";
      }
      // Raw HTML and anything else this renderer doesn't know about
      // yet: skip rather than guess (see module docstring).
      return "";
  }
}

function renderBlocks(nodes: readonly RootContent[], images: TypstImageRef[]): string {
  return nodes
    .map((n) => renderBlock(n, images))
    .filter((b) => b.length > 0)
    .join("\n\n");
}

/** The whole document (already past front matter — pass a letter's
 * BODY, from `splitFrontmatter`, through `parseOxDocument`) as Typst
 * markup, plus every vault image it names. Pure and synchronous: no
 * network, no filesystem — see module docstring for the split. */
export function renderOxDocumentToTypst(doc: OxDocument | Root): TypstRenderResult {
  const images: TypstImageRef[] = [];
  const typst = renderBlocks(doc.children, images);
  return { typst, images };
}
