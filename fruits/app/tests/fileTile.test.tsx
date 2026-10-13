/**
 * A `::file` that is not a picture shows as a file, not as a blank square
 * (Austin, 2026-10-13: PDFs on a daily log looked like nothing had
 * uploaded). Three states tell apart: uploaded non-picture (a tile that
 * opens the original), upload in flight (blank box), upload failed.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer, { fileKindLabel } from "../components/OxRenderer";

const render = (md: string, servedFileIds?: Record<string, string>) =>
  renderToStaticMarkup(<OxRenderer markdown={md} servedFileIds={servedFileIds} />);

describe("a non-picture file on a Card", () => {
  it("is a tile that names its kind and opens the original", () => {
    const html = render(`::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}`);
    expect(html).toContain('href="/api/vault/view/pdf1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">PDF<");
    expect(html).toContain(">plans.pdf<");
    expect(html).not.toContain("<img ");
  });

  it("opens the project's copy, never the original, when served ids are given", () => {
    const html = render(`::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}`, { pdf1: "copyPdf" });
    expect(html).toContain('href="/api/vault/view/copyPdf"');
    expect(html).not.toContain("pdf1");
  });

  it("stays a blank box while no id has landed", () => {
    const html = render(`::file{name="plans.pdf" caption}`);
    expect(html).not.toContain("ox-file-tile");
    expect(html).not.toContain("href=");
    expect(html).toContain('title="plans.pdf"');
  });

  it("says a failed upload failed", () => {
    const html = render(`::file{name="plans.pdf" caption uploadError="1"}`);
    expect(html).toContain('data-upload-error="true"');
    expect(html).toContain(">failed<");
    expect(html).not.toContain("href=");
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
