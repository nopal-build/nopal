/**
 * The INCOMPLETE line for an attachment with neither a caption nor a
 * description names the actual fix (2026-10-20). It used to say "a
 * caption on the file, or KNOWLEDGE.md turned on, fixes this" for every
 * cause; on This Healthy House that pointed a reader at a stage that was
 * already on, for a seed `.docx` that could take no caption and that
 * nothing read.
 */
import { describe, expect, it } from "vitest";
import { uncaptionedReason } from "robustness-core/data/syncGraph.server";
import { DOCX_CONTENT_TYPE } from "robustness-core/data/docxText.server";
import { isDescribableAttachment } from "robustness-core/data/syncKnowledge.server";

const docx = { name: "HISTORIC ENERGY COMPLIANCE REPORT.docx", describable: true, captionable: false };
const xlsx = { name: "takeoff.xlsx", describable: false, captionable: false };
const photo = { name: "2026-10-06-abc-IMG_1.jpeg", describable: true, captionable: true };

describe("uncaptionedReason", () => {
  it("names the files and never blames KNOWLEDGE.md when it is on", () => {
    const line = uncaptionedReason({ date: "2026-10-12", files: [docx], knowledgeOn: true });
    expect(line).toContain('2026-10-12: 1 attached file(s)');
    expect(line).toContain('"HISTORIC ENERGY COMPLIANCE REPORT.docx"');
    expect(line).not.toContain("turned on");
    expect(line).toContain("next run should describe");
  });

  it("says the stage is off when it is, and offers a caption only for a file that can take one", () => {
    const seedOnly = uncaptionedReason({ date: "2026-10-12", files: [docx], knowledgeOn: false });
    expect(seedOnly).toContain("skills/KNOWLEDGE.md is off");
    expect(seedOnly).not.toContain("caption on the file");
    const withPhoto = uncaptionedReason({ date: "2026-10-12", files: [docx, photo], knowledgeOn: false });
    expect(withPhoto).toContain("A caption on the file");
  });

  it("says nothing reads the kind, by extension, and that no retry fixes it", () => {
    const line = uncaptionedReason({ date: "2026-10-12", files: [xlsx], knowledgeOn: true });
    expect(line).toContain("Nothing here reads a .xlsx file");
    expect(line).toContain("no retry changes that");
    expect(line).not.toContain("KNOWLEDGE.md is off");
  });

  it("splits a mixed day: some the next run gets, some nothing reads", () => {
    const line = uncaptionedReason({ date: "2026-10-12", files: [photo, xlsx, { ...xlsx, name: "schedule.numbers" }], knowledgeOn: true });
    expect(line).toContain("1 of them KNOWLEDGE.md reads");
    expect(line).toContain("the other 2 (.xlsx, .numbers)");
  });

  it("lists at most three names and counts the rest", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ ...photo, name: `IMG_${i}.jpeg` }));
    const line = uncaptionedReason({ date: "2026-10-12", files, knowledgeOn: true });
    expect(line).toContain('"IMG_0.jpeg", "IMG_1.jpeg", "IMG_2.jpeg", and 2 more');
  });

  it("reads like a sentence to a person: no em dash, no code identifier but the skill file", () => {
    for (const knowledgeOn of [true, false]) {
      const line = uncaptionedReason({ date: "2026-10-12", files: [docx, xlsx, photo], knowledgeOn });
      expect(line).not.toContain("—");
      expect(line.replace(/skills\/KNOWLEDGE\.md|KNOWLEDGE\.md/g, "")).not.toMatch(/[A-Za-z]+\.(server|ts)\b|[a-z]+[A-Z][A-Za-z]+\(/);
    }
  });
});

describe("isDescribableAttachment is the one list of what sync-knowledge reads", () => {
  const base = { s3_key: "k", size: 1000, content: null };
  it("yes: image, video, PDF under the ceiling, Word file, stored text", () => {
    expect(isDescribableAttachment({ ...base, content_type: "image/jpeg", name: "a.jpeg" })).toBe(true);
    expect(isDescribableAttachment({ ...base, content_type: "video/mp4", name: "a.mp4" })).toBe(true);
    expect(isDescribableAttachment({ ...base, content_type: "application/pdf", name: "a.pdf" })).toBe(true);
    expect(isDescribableAttachment({ ...base, content_type: DOCX_CONTENT_TYPE, name: "a.docx" })).toBe(true);
    expect(isDescribableAttachment({ ...base, s3_key: null, content_type: "text/markdown", name: "a.md", content: "words" })).toBe(true);
  });
  it("no: a spreadsheet, an archive, a Word file not in storage", () => {
    expect(isDescribableAttachment({ ...base, content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "a.xlsx" })).toBe(false);
    expect(isDescribableAttachment({ ...base, content_type: "application/zip", name: "a.zip" })).toBe(false);
    expect(isDescribableAttachment({ ...base, s3_key: null, content_type: DOCX_CONTENT_TYPE, name: "a.docx" })).toBe(false);
  });
});
