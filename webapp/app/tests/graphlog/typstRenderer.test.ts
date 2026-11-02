/**
 * OxMarkdown → Typst (`oxmarkdown-core/src/typstRenderer.ts`), checked
 * against a REAL `typst compile`, not just "the generated string looks
 * right" — Typst typesets the wrong thing silently rather than erroring
 * on a markup mistake (bold/italic use a single delimiter character,
 * not CommonMark's double one; strikethrough/highlight have no
 * shorthand at all), so only reading the actual PDF's text back out
 * (via `pdftotext`, poppler) proves the escaping and the markup choices
 * are both right. Skips itself (not a hard failure) when either binary
 * isn't on `PATH` — same convention `hasFfmpeg()`-gated tests already
 * use in this repo — but CI installs both (`ci.yml`), so a real skip is
 * a local-machine-only event.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseOxDocument, renderOxDocumentToTypst } from "oxmarkdown-core";

const run = promisify(execFile);

function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasTypst = hasBinary("typst");
const hasPdftotext = hasBinary("pdftotext");

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const LETTER_MARKDOWN = `# The Crouch job

Framing is *done*, and the cladding install is _underway_. ~~Siding~~ Cladding was the word we settled on.

==Eaves start Monday.==

Cost so far: $4,250 (about 85% of budget).

- Now: rows going on all the way around
- Next: the eaves
- [x] Permit pulled
- [ ] Final inspection

::video{fileId="v1"}

![job site](/api/vault/view/IMAGE_FILE_ID)
`;

describe("renderOxDocumentToTypst, compiled for real", () => {
  it("escapes Typst's own delimiters, renders an image reference, and prints a directive placeholder", async () => {
    if (!hasTypst || !hasPdftotext) return;

    const doc = parseOxDocument(LETTER_MARKDOWN);
    const { typst, images } = renderOxDocumentToTypst(doc);

    expect(images).toEqual([{ placeholder: "image-0.jpg", fileId: "IMAGE_FILE_ID" }]);
    // Bold/italic as Typst markup, not left-over CommonMark delimiters.
    expect(typst).toContain("*done*");
    expect(typst).toContain("_underway_");
    expect(typst).toContain("#strike[Siding]");
    expect(typst).toContain("#highlight[Eaves start Monday.]");
    // The dollar sign and percent-adjacent text are escaped so Typst
    // doesn't read `$4,250` as the start of a math span.
    expect(typst).toContain("\\$4,250");
    expect(typst).toContain("#image(\"image-0.jpg\", width: 100%)");
    expect(typst).toContain("This letter includes a video");

    const dir = await mkdtemp(path.join(tmpdir(), "typst-renderer-test-"));
    try {
      await writeFile(path.join(dir, "letter.typ"), typst, "utf8");
      await writeFile(path.join(dir, "image-0.jpg"), await readFile(path.join(fixturesDir, "tiny.jpg")));
      await run("typst", ["compile", "letter.typ", "letter.pdf"], { cwd: dir });

      const { stdout: text } = await run("pdftotext", [path.join(dir, "letter.pdf"), "-"]);
      expect(text).toContain("The Crouch job");
      expect(text).toContain("done");
      expect(text).toContain("underway");
      expect(text).toContain("Siding");
      expect(text).toContain("Eaves start Monday.");
      expect(text).toMatch(/\$4,250/);
      expect(text).toContain("Now: rows going on all the way around");
      expect(text).toContain("This letter includes a video");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("skips an unrecognized directive and a non-vault image without failing the compile", async () => {
    if (!hasTypst) return;
    const doc = parseOxDocument("Before\n\n::mystery{}\n\n![external](https://example.com/photo.jpg)\n\nAfter");
    const { typst, images } = renderOxDocumentToTypst(doc);
    expect(images).toEqual([]);
    expect(typst).not.toContain("mystery");
    expect(typst).toContain("Before");
    expect(typst).toContain("After");

    const dir = await mkdtemp(path.join(tmpdir(), "typst-renderer-test-"));
    try {
      await writeFile(path.join(dir, "letter.typ"), typst, "utf8");
      await expect(run("typst", ["compile", "letter.typ", "letter.pdf"], { cwd: dir })).resolves.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
