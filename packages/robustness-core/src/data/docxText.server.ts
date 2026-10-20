/**
 * The text of a Word file (`.docx`), read by code so `sync-knowledge` can
 * hand it to the model the way it hands over any text attachment.
 *
 * Why this exists: on 2026-10-13 a 14 KB `.docx` ("HISTORIC ENERGY
 * COMPLIANCE REPORT") was added to This Healthy House's seed packet.
 * Nothing in the pipeline read Word files, so sync-knowledge kept it as a
 * file, sync-graph found it with neither a caption nor a description, and
 * the Efforts page carried an INCOMPLETE banner telling the reader to turn
 * KNOWLEDGE.md on. KNOWLEDGE.md was on. The file type was the gap.
 *
 * A `.docx` is a zip; the body is `word/document.xml`; the words are the
 * text of `<w:t>` elements, with `<w:p>` closing a paragraph and `<w:tab/>`
 * a tab. That is all this reads: no styles, no tables-as-tables (a table
 * cell's text still comes out, one paragraph per cell), no images, no
 * headers or footers, no tracked changes (deleted text under `<w:delText>`
 * is left out). Enough for a report or a letter, which is what lands in a
 * seed packet. A richer reader is a dependency decision for later; this
 * one has none.
 *
 * Dependency-free on purpose: `node:zlib` already inflates deflate
 * streams, and a zip's central directory is a few fixed-layout records.
 * Only the entry this needs is inflated.
 */

import { inflateRawSync } from "node:zlib";

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The worker holds the whole file in memory to unzip it; a Word file of
 * prose is well under a megabyte, so this ceiling is about a pathological
 * upload, not a normal one. Bigger is kept as a file, not read. */
export const DOCX_MAX_BYTES = 50 * 1024 * 1024;

export function isDocx(source: { content_type: string; name: string; s3_key: string | null; size?: number | null }): boolean {
  if (!source.s3_key) return false;
  if ((source.size ?? 0) > DOCX_MAX_BYTES) return false;
  return source.content_type === DOCX_CONTENT_TYPE || source.name.toLowerCase().endsWith(".docx");
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DOCUMENT_ENTRY = "word/document.xml";

/**
 * Reads one named entry out of a zip held in memory, or null when the
 * bytes are not a zip or hold no such entry. Only `stored` (0) and
 * `deflate` (8) entries are understood; anything else is null.
 */
export function readZipEntry(zip: Buffer, entryName: string): Buffer | null {
  // The end-of-central-directory record sits at the tail, after an
  // optional comment of up to 64 KB; scan back for its signature.
  const minEocd = 22;
  if (zip.length < minEocd) return null;
  let eocd = -1;
  for (let i = zip.length - minEocd; i >= Math.max(0, zip.length - minEocd - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);

  let pos = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== CENTRAL_SIGNATURE) return null;
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    pos += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;

    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
    // The local header's own name/extra lengths can differ from the
    // central directory's (the extra field often does); the data starts
    // after the local ones.
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    return null;
  }
  return null;
}

/** Decodes the five XML entities Word writes into text (`&amp;`, `&lt;`,
 * `&gt;`, `&quot;`, `&apos;`) and numeric references. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The paragraphs of a `word/document.xml`, one per line, blank lines
 * collapsed. Exported for the test; `docxText` is the entry point.
 */
export function documentXmlToText(xml: string): string {
  // Deleted text (tracked changes) is not part of the document as read.
  const withoutDeleted = xml.replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, "");
  const parts: string[] = [];
  // One pass over the tags that carry text or structure, in document order.
  // `<w:p/>` is an empty paragraph written self-closing; it ends a line
  // like `</w:p>` does. `\b` keeps `<w:pPr>` (paragraph properties) out.
  const tokens = withoutDeleted.matchAll(
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<\/w:p>|<w:p\b[^>]*\/>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g,
  );
  for (const token of tokens) {
    const tag = token[0];
    if (tag.startsWith("<w:t")) {
      if (tag.startsWith("<w:tab")) parts.push("\t");
      else if (token[1] !== undefined) parts.push(decodeXmlEntities(token[1]));
    } else if (tag === "</w:p>" || tag.startsWith("<w:p")) {
      parts.push("\n");
    } else {
      // <w:br/> and <w:cr/>: a line break inside a paragraph.
      parts.push("\n");
    }
  }
  return parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The text of a `.docx` held in memory, or null when the bytes are not a
 * Word file (not a zip, or a zip with no `word/document.xml`) or the
 * document has no text at all. Never throws on bad bytes: a corrupt
 * upload is "nothing readable here", which the caller treats as kept as
 * a file.
 */
export function docxText(bytes: Buffer): string | null {
  let xml: Buffer | null;
  try {
    xml = readZipEntry(bytes, DOCUMENT_ENTRY);
  } catch {
    return null;
  }
  if (!xml) return null;
  const text = documentXmlToText(xml.toString("utf8"));
  return text.length > 0 ? text : null;
}
