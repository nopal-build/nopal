/**
 * decodeMarkdownEntities.ts
 *
 * Decodes HTML character references that mdast-util-to-markdown injects when
 * serialising Lexical content to markdown.  For example, a paragraph that
 * starts with a space is escaped as `&#x20; text` to prevent remark from
 * interpreting the leading whitespace as an indented code block.
 *
 * remark-parse handles these entities correctly in regular paragraph text, but
 * code spans and fenced code blocks are verbatim — the raw entity strings leak
 * through to the rendered output.  Pre-decoding them before the markdown
 * processor sees the string removes the artefacts in all contexts.
 *
 * Only the entities that mdast-util-to-markdown actually emits are decoded:
 *   - Hex numeric refs:     &#xNN;   (e.g. &#x20; → space)
 *   - Decimal numeric refs: &#NN;    (e.g. &#32; → space)
 *   - Named refs:           &amp; &lt; &gt; &quot; &apos;
 */
export function decodeMarkdownEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
