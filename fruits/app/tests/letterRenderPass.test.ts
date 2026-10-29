/**
 * The worker's render pass (`letterRenderPass.server.ts`, 2026-10-29):
 * how a sent letter whose link is off is printed with no session. A pass
 * opens one letter until it expires, and only in the shape the worker
 * writes; the paper the worker prints on carries the page number and
 * nothing else in its margins. The database is stubbed; the rules are
 * what is under test.
 */
import { describe, expect, it, vi } from "vitest";

const rows = new Map<string, Record<string, unknown>>();
vi.mock("robustness-core/data/generic.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/generic.server")>();
  return {
    ...actual,
    defineTable: vi.fn(async () => []),
    upsert: vi.fn(async (rid: { tb: string; id: string }, row: Record<string, unknown>) => {
      rows.set(String(rid.id), row);
      return row;
    }),
    select: vi.fn(async (rid: { id: string }) => rows.get(String(rid.id))),
    remove: vi.fn(async (_tb: string, id: string) => {
      rows.delete(id);
    }),
  };
});

const { closeRenderPass, isRenderPassShape, LETTER_RENDER_HEADER, openRenderPass, passOpens, requestHasRenderPass, RENDER_PASS_TTL_MS } = await import(
  "robustness-core/data/letterRenderPass.server"
);

const withPass = (pass: string | null) => new Request("http://fruits:3000/public/letter/l1", { headers: pass ? { [LETTER_RENDER_HEADER]: pass } : {} });

describe("a render pass", () => {
  it("opens the one letter it was written for, until it expires", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const row = { letter_file_id: "l1", expires_at: new Date(now + 1000).toISOString() };
    expect(passOpens(row, "l1", now)).toBe(true);
    expect(passOpens(row, "l2", now)).toBe(false);
    expect(passOpens(row, "l1", now + 1000)).toBe(false);
    expect(passOpens({ letter_file_id: "l1", expires_at: "not a date" }, "l1", now)).toBe(false);
    expect(passOpens(null, "l1", now)).toBe(false);
  });

  it("has one shape, checked before the database is asked", () => {
    expect(isRenderPassShape("a".repeat(48))).toBe(true);
    expect(isRenderPassShape("a".repeat(47))).toBe(false);
    expect(isRenderPassShape("A".repeat(48))).toBe(false);
    expect(isRenderPassShape("' OR 1=1 --")).toBe(false);
    expect(isRenderPassShape(null)).toBe(false);
  });

  it("is honoured on a request for its letter while open, and on nothing once closed", async () => {
    const pass = await openRenderPass("l1");
    expect(isRenderPassShape(pass)).toBe(true);
    expect(await requestHasRenderPass(withPass(pass), "l1")).toBe(true);
    expect(await requestHasRenderPass(withPass(pass), "l2")).toBe(false);
    expect(await requestHasRenderPass(withPass(null), "l1")).toBe(false);
    expect(await requestHasRenderPass(withPass("f".repeat(48)), "l1")).toBe(false);
    await closeRenderPass(pass);
    expect(await requestHasRenderPass(withPass(pass), "l1")).toBe(false);
  });

  it("lasts minutes, not hours", () => {
    expect(RENDER_PASS_TTL_MS).toBeGreaterThanOrEqual(60_000);
    expect(RENDER_PASS_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("the paper", () => {
  it("is Letter at 0.6in with the page number alone in the footer and nothing in the header", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Read as text: the renderer imports playwright-core, which the app
    // never loads (`noMediaProcessingInApp.test.ts`).
    const src = readFileSync(path.join(here, "../../../packages/robustness-core/src/data/letterPdfRender.server.ts"), "utf8");
    expect(src).toContain('format: "Letter"');
    expect(src).toContain('margin: { top: "0.6in", right: "0.6in", bottom: "0.6in", left: "0.6in" }');
    expect(src).toContain("displayHeaderFooter: true");
    expect(src).toContain('headerTemplate: "<span></span>"');
    const footer = src.match(/footerTemplate:\s*'([^']*)'/)?.[1] ?? "";
    expect(footer).toContain('<span class="pageNumber"></span>');
    expect(footer).not.toMatch(/title|date|url|totalPages/);
    // The pass reaches the app's origin only, and is closed whatever happens.
    expect(src).toMatch(/origin !== new URL\(origin\)\.origin\) return route\.continue\(\)/);
    expect(src).toMatch(/finally \{[^}]*closeRenderPass\(pass\)/);
  });
});

describe("a change to the paper", () => {
  it("prints every letter again: the key and the job carry the render version, not only the sent copy's hash", async () => {
    const { letterPdfJobId, letterPdfKey, LETTER_PDF_RENDER_VERSION } = await import("robustness-core/data/letterPdf.server");
    expect(LETTER_PDF_RENDER_VERSION).toBeGreaterThanOrEqual(2);
    expect(letterPdfKey("l1", "h1")).toBe(`letters/l1/h1-r${LETTER_PDF_RENDER_VERSION}.pdf`);
    // Version 1's key, still in storage for every letter sent before 2026-10-29.
    expect(letterPdfKey("l1", "h1")).not.toBe("letters/l1/h1.pdf");
    expect(letterPdfJobId("l1", "h1")).toBe(`pdf-l1-h1-r${LETTER_PDF_RENDER_VERSION}`);
    expect(letterPdfJobId("l1", "h1")).not.toContain(":");
  });
});
