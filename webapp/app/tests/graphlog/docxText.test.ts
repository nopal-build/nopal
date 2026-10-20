/**
 * A Word file has a path into the graph (2026-10-20). This Healthy
 * House's seed packet held a 14 KB `.docx` nothing read: sync-knowledge
 * kept it as a file, sync-graph counted it uncaptioned, and the Efforts
 * page told the reader to turn KNOWLEDGE.md on when it already was. The
 * reader here is dependency-free, so the test builds its own zip.
 */
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DOCX_CONTENT_TYPE, docxText, documentXmlToText, isDocx, readZipEntry } from "robustness-core/data/docxText.server";

/** A minimal zip writer: local headers, central directory, end record.
 * `stored` when `deflate` is false, so both methods get a test. */
function zip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.deflate === false ? 0 : 8;
    const data = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>HISTORIC ENERGY COMPLIANCE REPORT</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Prepared for Paul &amp; Erica Campbell, </w:t></w:r><w:r><w:t>2026-10-12</w:t></w:r></w:p>
<w:p/>
<w:p><w:r><w:t>Wall R-value</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>R-13</w:t></w:r></w:p>
<w:p><w:ins><w:r><w:t>Attic R-38</w:t></w:r></w:ins><w:del><w:r><w:delText>Attic R-30</w:delText></w:r></w:del></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Window U</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0.30</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Line one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>line two &lt;tagged&gt;</w:t></w:r></w:p>
</w:body></w:document>`;

function docx(deflate = true): Buffer {
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>"), deflate },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8"), deflate },
    { name: "word/styles.xml", data: Buffer.from("<w:styles/>"), deflate },
  ]);
}

describe("docxText", () => {
  it("reads the paragraphs of a Word file, in order, with tabs, breaks, entities, table cells, and no deleted text", () => {
    const text = docxText(docx());
    expect(text).toBe(
      [
        "HISTORIC ENERGY COMPLIANCE REPORT",
        "Prepared for Paul & Erica Campbell, 2026-10-12",
        "",
        "Wall R-value\tR-13",
        "Attic R-38",
        "Window U",
        "0.30",
        "Line one",
        "line two <tagged>",
      ].join("\n"),
    );
    expect(text).not.toContain("R-30");
  });

  it("reads a stored (uncompressed) zip the same as a deflated one", () => {
    expect(docxText(docx(false))).toBe(docxText(docx(true)));
  });

  it("finds an entry by name and ignores the others", () => {
    const bytes = docx();
    expect(readZipEntry(bytes, "word/styles.xml")?.toString()).toBe("<w:styles/>");
    expect(readZipEntry(bytes, "word/footer1.xml")).toBeNull();
  });

  it("is null, never a throw, for bytes that are not a Word file", () => {
    expect(docxText(Buffer.from("%PDF-1.4 not a zip at all"))).toBeNull();
    expect(docxText(Buffer.alloc(0))).toBeNull();
    // A zip, but not a Word file: no word/document.xml.
    expect(docxText(zip([{ name: "readme.txt", data: Buffer.from("hello") }]))).toBeNull();
    // A Word file with no words.
    expect(docxText(zip([{ name: "word/document.xml", data: Buffer.from("<w:document><w:body><w:p/></w:body></w:document>") }]))).toBeNull();
  });

  it("documentXmlToText collapses runs of blank paragraphs to one blank line", () => {
    expect(documentXmlToText("<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p/><w:p/><w:p/><w:p><w:r><w:t>b</w:t></w:r></w:p>")).toBe("a\n\nb");
  });

  it("isDocx: by content type or by name, only when the bytes are in storage and under the ceiling", () => {
    expect(isDocx({ content_type: DOCX_CONTENT_TYPE, name: "report.docx", s3_key: "k", size: 14640 })).toBe(true);
    expect(isDocx({ content_type: "application/octet-stream", name: "report.DOCX", s3_key: "k", size: 100 })).toBe(true);
    expect(isDocx({ content_type: DOCX_CONTENT_TYPE, name: "report.docx", s3_key: null, size: 100 })).toBe(false);
    expect(isDocx({ content_type: DOCX_CONTENT_TYPE, name: "report.docx", s3_key: "k", size: 51 * 1024 * 1024 })).toBe(false);
    expect(isDocx({ content_type: "application/pdf", name: "report.pdf", s3_key: "k", size: 100 })).toBe(false);
  });
});
