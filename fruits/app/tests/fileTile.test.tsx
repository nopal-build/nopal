/**
 * A `::file` that is not a picture shows as a file, not as a blank square
 * (Austin, 2026-10-13: PDFs on a daily log looked like nothing had
 * uploaded). Three states tell apart: uploaded non-picture (a compact
 * icon+name row that opens the original), upload in flight (the same
 * row, not yet a link, with a progress bar below it), upload failed (the
 * row tinted, the real reason and a Retry action below it). The kind is
 * a real icon now (2026-11-01), decorative (the name right beside it
 * already says what it is), not a text badge inside a 74px box.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer, { fileKindLabel } from "../components/OxRenderer";
import {
  fileKindIcon,
  FileTypePdfIcon,
  FileTypeDocIcon,
  FileTypeDocxIcon,
  FileTypeTxtIcon,
  FileTypeZipIcon,
  FileSmileIcon,
} from "../components/FileKindIcon";

const render = (md: string, servedFileIds?: Record<string, string>) =>
  renderToStaticMarkup(<OxRenderer markdown={md} servedFileIds={servedFileIds} />);

describe("a non-picture file on a Card", () => {
  it("is a compact row that opens the original, with a real (decorative) kind icon", () => {
    const html = render(`::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}`);
    expect(html).toContain('href="/api/vault/view/pdf1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("ox-file-inline");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain(">PDF<");
  });

  it("shows the filename directly beside the icon, not bold", () => {
    const html = render(`::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}`);
    expect(html).toContain("ox-file-name-label");
    expect(html).toContain(">plans.pdf<");
  });

  it("opens the project's copy, never the original, when served ids are given", () => {
    const html = render(`::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}`, { pdf1: "copyPdf" });
    expect(html).toContain('href="/api/vault/view/copyPdf"');
    expect(html).not.toContain("pdf1");
  });

  it("stays the same row, not yet a link, with a progress bar below it while no id has landed", () => {
    const html = render(`::file{name="plans.pdf" caption}`);
    expect(html).not.toContain("ox-file-tile\"");
    expect(html).not.toContain("href=");
    expect(html).toContain('title="plans.pdf"');
    expect(html).toContain('role="progressbar"');
  });

  it("tints the row red on failure, rather than a boxed badge", () => {
    const html = render(`::file{name="plans.pdf" caption uploadError="1"}`);
    expect(html).toContain('data-upload-error="true"');
    expect(html).not.toContain("href=");
  });

  it("shows the real failure reason beside the tile when one was recorded", () => {
    const html = render(`::file{name="plans.pdf" caption uploadError="1" uploadErrorMessage="The upload failed (500)."}`);
    expect(html).toContain("The upload failed (500).");
  });

  it("falls back to a generic line when no reason was recorded", () => {
    const html = render(`::file{name="plans.pdf" caption uploadError="1"}`);
    expect(html).toContain("Upload failed.");
  });
});

describe("fileKindLabel", () => {
  it("prefers the filename's extension", () => {
    expect(fileKindLabel("plans.pdf", "application/pdf")).toBe("PDF");
    expect(fileKindLabel("budget.XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("XLSX");
  });
  it("falls back to the content type, then to FILE", () => {
    expect(fileKindLabel("scan", "application/pdf")).toBe("PDF");
    expect(fileKindLabel("blob", "application/octet-stream")).toBe("FILE");
    expect(fileKindLabel("blob")).toBe("FILE");
    expect(fileKindLabel("report.final", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("FINAL");
  });
});

describe("fileKindIcon", () => {
  it("picks a real per-kind glyph for pdf/doc/docx/txt/zip", () => {
    expect(fileKindIcon("plans.pdf")).toBe(FileTypePdfIcon);
    expect(fileKindIcon("report.doc")).toBe(FileTypeDocIcon);
    expect(fileKindIcon("report.docx")).toBe(FileTypeDocxIcon);
    expect(fileKindIcon("notes.txt")).toBe(FileTypeTxtIcon);
    expect(fileKindIcon("archive.zip")).toBe(FileTypeZipIcon);
  });
  it("falls back to content type when the extension doesn't say", () => {
    expect(fileKindIcon("scan", "application/pdf")).toBe(FileTypePdfIcon);
    expect(fileKindIcon("notes", "text/plain")).toBe(FileTypeTxtIcon);
  });
  it("falls back to the generic file-smile icon for anything else", () => {
    expect(fileKindIcon("budget.xlsx")).toBe(FileSmileIcon);
    expect(fileKindIcon("blob", "application/octet-stream")).toBe(FileSmileIcon);
  });
});
