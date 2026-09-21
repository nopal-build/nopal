/**
 * What counts as the page a mark was written on (`pageBody.server.ts`),
 * and where an unread mark sits once the page moves (`anchorMark`).
 *
 * There is one page and no archive. A mark lives on its page until that
 * page is rewritten, read or not. Once it is rewritten the page speaks
 * for the mark, citing the entry it became, and the words stay in the
 * project's `Syncs/Marks/` record. A mark nothing has read yet never
 * disappears: it re-anchors and waits.
 */

import { describe, expect, it } from "vitest";
import { pageBody, pageHash } from "robustness-core/data/pageBody.server";
import { withIncompleteBanner } from "robustness-core/data/project.types";
import { anchorMark, type MarkUnitSnapshot } from "robustness-core/data/graphLogMarks.server";
import { computeMarkUnitsFromMarkdown } from "oxmarkdown-core";

const FRONT = "---\nsharing:\n  - human: admin_1\n    role: Owner\n---\n";
const BODY = "# Crouch\n\nThe read.\n## On the bench\n### Gerald · Cladding · M\n\n- Now: rows\n## Shelf\n- Landscaping\n";

describe("the page a mark was written on", () => {
  it("ignores front matter, the incomplete banner and change tags", () => {
    const base = pageHash(FRONT + BODY);
    expect(pageHash(BODY)).toBe(base);
    expect(pageHash(FRONT.replace("Owner", "Observer") + BODY)).toBe(base);
    expect(pageHash(FRONT + withIncompleteBanner(BODY, ["a section was cut off"]))).toBe(base);
    expect(pageHash(FRONT + BODY.replace("Cladding · M", "Cladding · M {moved}"))).toBe(base);
  });

  it("changes when a reader would see a change", () => {
    const base = pageHash(FRONT + BODY);
    expect(pageHash(FRONT + BODY.replace("rows", "rows done"))).not.toBe(base);
    const reordered = "# Crouch\n\nThe read.\n## Shelf\n- Landscaping\n## On the bench\n### Gerald · Cladding · M\n\n- Now: rows\n";
    expect(pageHash(FRONT + reordered)).not.toBe(base);
  });

  it("keeps the body a reader saw, without the wrapping", () => {
    expect(pageBody(FRONT + withIncompleteBanner(BODY, ["x"]))).toBe(BODY.trim());
    expect(pageBody(FRONT)).toBe("");
  });
});

describe("where an unread mark sits once the page moves", () => {
  const ref = (file: string) => `:ref{name="Gerald L" human-id="super_1" datetime="2026-09-09T12:00:00Z" location="/vault?file=${file}"}`;
  const was = `## On the bench\n### Gerald · Cladding · M\n\n- Now: rows going on ${ref("meo")}\n`;
  const now = `## On the bench\n### Gerald · Cladding · M\n\n- Now: eaves started, cladding closed ${ref("meo")}\n`;
  const units = (md: string) => computeMarkUnitsFromMarkdown(md);
  const snapshotOf = (md: string, text: string): MarkUnitSnapshot => {
    const u = units(md).find((x) => x.text.startsWith(text))!;
    return { key: u.key, kind: u.kind, section: u.section, effort: u.effort, text: u.text, refs: u.refs, attachmentId: u.attachmentId };
  };
  const written = snapshotOf(was, "Now:");

  it("stays on its own words while they are on the page", () => {
    expect(anchorMark(units(was), written)).toBe(written.key);
  });

  it("moves to a line citing the same entry when its own words are rewritten", () => {
    const anchored = anchorMark(units(now), written);
    const line = units(now).find((u) => u.key === anchored);
    expect(line?.text).toContain("eaves started");
  });

  it("falls back to its own section's heading, then the top of the page", () => {
    const noCitation = "## On the bench\n### Gerald · Cladding · M\n\n- Now: something else\n";
    expect(anchorMark(units(noCitation), written)).toBe(
      units(noCitation).find((u) => u.kind === "heading" && u.text === "On the bench")!.key,
    );
    const nothingLeft = "## Shelf\n- Landscaping\n";
    expect(anchorMark(units(nothingLeft), written)).toBe(units(nothingLeft)[0].key);
    expect(anchorMark([], written)).toBeNull();
  });
});
