/**
 * The send (2026-10-28): the letter's words go into the graph as the
 * sending guide's words on the send day, by a projection named like a
 * Card (`letterSync.server.ts`); a resend replaces them; a letter moved
 * to another day leaves its old file emptied, never deleted (card 413).
 * The writer of the sent fields is one function (`letterSend.server.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LETTERS_SYNC_FOLDER_NAME, lettersProjectionFiles } from "robustness-core/data/letterSync.server";

const core = path.join(__dirname, "../../../../packages/robustness-core/src/data");
const read = (name: string) => readFileSync(path.join(core, name), "utf8");

const attic = { fileId: "f1", name: "madison-attic.md", senderHumanId: "guide1", sent: { content: "---\ntitle: Madison attic\n---\n\n# Madison attic\n\nThe floor should be oak.\n", hash: "h1", at: "2026-10-28T15:00:00Z", date: "2026-10-28", count: 1, byHumanId: "guide1" } };
const porch = { fileId: "f2", name: "porch.md", senderHumanId: "guide1", sent: { content: "# Porch\n\nScreens next spring.\n", hash: "h2", at: "2026-10-28T16:00:00Z", date: "2026-10-28", count: 1, byHumanId: "guide1" } };
const other = { fileId: "f3", name: "roof.md", senderHumanId: "guide2", sent: { content: "# Roof\n\nSlate.\n", hash: "h3", at: "2026-10-28T09:00:00Z", date: "2026-10-28", count: 2, byHumanId: "guide2" } };

describe("the letters projection", () => {
  it("is one file per guide per send day (the sender's own day, not the instant's), named like a Card so sync-graph reads it as that guide's words", () => {
    const files = lettersProjectionFiles([attic, porch, other]);
    // Sent late in the evening: the instant is the next UTC day, the file is the sender's day.
    expect(lettersProjectionFiles([{ ...attic, sent: { ...attic.sent, at: "2026-10-29T04:30:00Z", date: "2026-10-28" } }])[0].name).toBe("2026-10-28-guide1.md");
    expect(files.map((f) => f.name)).toEqual(["2026-10-28-guide1.md", "2026-10-28-guide2.md"]);
    expect(files[0].date).toBe("2026-10-28");
    expect(files[0].name).toMatch(/^\d{4}-\d{2}-\d{2}-[^-]+\.md$/);
  });

  it("holds each letter as its title and sent body, front matter stripped, letters in send order and separated", () => {
    const [guide1] = lettersProjectionFiles([porch, attic]);
    expect(guide1.content).toBe("## Madison attic\n\n# Madison attic\n\nThe floor should be oak.\n\n---\n\n## porch\n\n# Porch\n\nScreens next spring.\n");
    expect(guide1.content).not.toContain("title: Madison attic");
  });

  it("a resend on another day moves the letter to that day's file; the old day's file is no longer wanted (and is emptied, not deleted, by the writer)", () => {
    const resent = { ...attic, sent: { ...attic.sent, at: "2026-10-30T10:00:00Z", date: "2026-10-30", count: 2 } };
    const files = lettersProjectionFiles([resent, porch]);
    expect(files.map((f) => f.name)).toEqual(["2026-10-28-guide1.md", "2026-10-30-guide1.md"]);
    expect(files[0].content).not.toContain("Madison attic");
    expect(files[1].content).toContain("Madison attic");
    const src = read("letterSync.server.ts");
    expect(src).toContain('await updateFileRef(file._id, { content: "", content_hash: emptyHash })');
    expect(src).not.toContain("deleteFileRef");
  });

  it("is the same content for the same letters", () => {
    expect(lettersProjectionFiles([attic, porch])).toEqual(lettersProjectionFiles([porch, attic]));
    expect(lettersProjectionFiles([])).toEqual([]);
  });

  it("lives under Syncs, beside Marks, and is rebuilt by the send and by the daily sync", () => {
    expect(LETTERS_SYNC_FOLDER_NAME).toBe("Letters");
    expect(read("letterSend.server.ts")).toContain("await syncLettersProjection(home.project)");
    const sync = read("dailyLogSync.server.ts");
    expect(sync.indexOf("await syncMarksProjection(projectFolder)")).toBeLessThan(sync.indexOf("await syncLettersProjection(projectFolder)"));
  });
});

describe("the sent fields' one writer", () => {
  it("is sendLetter, by merge (never updateFileRef, which bumps updated_at), plus the one-time backfill", () => {
    const send = read("letterSend.server.ts");
    expect(send).toContain('await merge("file_refs", file._id, sent)');
    expect(send).not.toContain("updateFileRef(");
    expect(send).toContain("sent_count: (before?.count ?? 0) + 1");
    expect(send).toContain("sent_date: markDate(input.date)");
    expect(send).toContain("sent_at: sentAt");
    // The only other `sent_at:` write is the backfill in letters.server.ts.
    const letters = read("letters.server.ts");
    expect((letters.match(/sent_at: /g) ?? []).length).toBe(1);
    expect(letters).toContain("export async function ensureSentCopy");
    for (const name of ["dailyLogSync.server.ts", "letterPdf.server.ts", "vault.server.ts", "outline.server.ts", "brief.server.ts"]) {
      expect(read(name), name).not.toMatch(/sent_at:\s/);
    }
  });

  it("the PDF is of the sent copy and is asked for on send while the link is on", () => {
    const send = read("letterSend.server.ts");
    expect(send).toContain("await enqueueLetterPdfIfShared(after)");
    const pdf = read("letterPdf.server.ts");
    expect(pdf).toContain("return sentCopyOf(file)?.hash ?? contentFingerprint(file)");
    expect(pdf).toContain("!isLetterSent(file)");
  });
});
