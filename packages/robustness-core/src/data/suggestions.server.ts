import { firstName } from "./humanNames";
/**
 * Suggestions (Austin, 2026-09-28). Someone whose group has no `feeds`
 * (an Observer) writes Cards and notes like anyone on the project, but
 * none of it goes in by itself: it waits here until a Guide takes it or
 * passes it. Taken, it goes in as written, credited to whoever wrote it.
 *
 * Who decides is a person, the Guide. Code only holds the words back and
 * routes them:
 *   - a Card is marked `suggestion` when it is made and feeds the project
 *     only its `taken_content` (`fedContent` in `dailyLog.server.ts`);
 *     words written after a take or a pass wait again;
 *   - a note carries `suggestion: "pending"` and every read that reaches
 *     the page run, the margin, the files view or the syncs leaves it out
 *     until it is "taken" (`FEEDS` in `graphLogMarks.server.ts`).
 *
 * Before a Guide acts, only the writer and the project's Guides see it.
 */

import { RecordId } from "surrealdb";
import { query, formatRecord, merge } from "./generic.server";
import type { FileRef, VaultFolder } from "./vault.types";
import { getHumansById } from "./humans.server";
import { getMark, listSuggestionMarks, markContextLine, type SuggestionStatus } from "./graphLogMarks.server";
import { runDailyLogSync, syncMarksProjection } from "./dailyLogSync.server";
import { listPacketFiles, listSeedQuestions, seedQuestionMeaning, seedQuestionSentence } from "./seedPackets.server";
import { decideSeedQuestion } from "./sow.server";

export type Suggestion = {
  /** A `question` is raised by the sow stage about one line from a seed
   * packet (`seedPackets.server.ts`): a yes or no, not a take or pass. */
  kind: "card" | "note" | "question";
  id: string;
  authorHumanId: string;
  authorName: string;
  date: string;
  /** The Card's words, or the note's. */
  text: string;
  /** For a note: the passage or file it was written on. */
  context: string | null;
  status: SuggestionStatus;
  /** For a question: what yes and no each do, in a line. */
  answers?: { yes: string; no: string };
};

/** Where a suggestion Card stands: its current words against what a
 * Guide last took or passed. */
export function cardStatus(card: Pick<FileRef, "content" | "taken_content" | "passed_content">): SuggestionStatus {
  const content = card.content ?? "";
  if (content === (card.taken_content ?? null)) return "taken";
  if (content === (card.passed_content ?? null)) return "passed";
  return "pending";
}

/**
 * A project's suggestions: every one waiting, for a Guide (`authorHumanId`
 * omitted); or everything one person suggested, waiting or decided, for
 * that person. Newest first.
 */
export async function listSuggestions(projectFolderId: string, authorHumanId?: string): Promise<Suggestion[]> {
  const byAuthor = authorHumanId ? "AND human_id = $authorHumanId" : "";
  const cardRows = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE source = 'daily_log_card' AND project_folder_id = $projectFolderId
       AND suggestion = true ${byAuthor}`,
    { projectFolderId, authorHumanId },
  );
  const cards = (cardRows?.[0] ?? []).map((r) => formatRecord(r as unknown as FileRef));
  const marks = await listSuggestionMarks(projectFolderId, authorHumanId);

  const out: Omit<Suggestion, "authorName">[] = [
    ...cards
      .filter((c) => (c.content ?? "").trim() && c.date)
      .map((c) => ({
        kind: "card" as const,
        id: c._id,
        authorHumanId: c.human_id,
        date: c.date!,
        text: c.content ?? "",
        context: null,
        status: cardStatus(c),
      })),
    ...marks.map((m) => ({
      kind: "note" as const,
      id: m._id,
      authorHumanId: m.author_human_id,
      date: m.date,
      text: m.text,
      context: markContextLine(m.unit),
      status: m.suggestion as SuggestionStatus,
    })),
  ].filter((s) => authorHumanId || s.status === "pending");

  // Questions from sowing: for the Guides alone, and only while waiting.
  // The "author" is whose packet the line came from.
  const questions = authorHumanId ? [] : await listSeedQuestions(projectFolderId, "pending");
  const packetOwners = new Map<string, string>();
  if (questions.length > 0) {
    for (const f of await listPacketFiles(projectFolderId)) packetOwners.set(f._id, f.human_id);
  }

  const names = new Map(
    (
      await getHumansById([...new Set([...out.map((s) => s.authorHumanId), ...packetOwners.values()])])
    ).map((h) => [h._id, firstName(h)]),
  );
  const asked: Suggestion[] = questions.map((q) => {
    const owner = packetOwners.get(q.packet_file_id) ?? "";
    return {
      kind: "question" as const,
      id: q._id,
      authorHumanId: owner,
      authorName: `${names.get(owner) ?? "Someone"}'s seed packet`,
      date: q.date,
      text: q.text,
      context: seedQuestionSentence(q),
      status: "pending" as const,
      answers: seedQuestionMeaning(q),
    };
  });
  return [
    ...asked,
    ...out
      .map((s) => ({ ...s, authorName: names.get(s.authorHumanId) ?? "Someone" }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  ];
}

/**
 * A Guide takes or passes one suggestion. Taking a Card feeds its words
 * as they stand now and re-syncs the day; taking a note lets the page run
 * and the syncs read it. Passing keeps it out. The caller checks that the
 * Guide may (`suggestions` feature on this project).
 */
export async function decideSuggestion(input: {
  project: VaultFolder;
  kind: "card" | "note" | "question";
  id: string;
  verdict: "take" | "pass";
  guideHumanId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { project, kind, id, verdict, guideHumanId } = input;
  // A question's two buttons are Yes and No; they travel as take and pass.
  if (kind === "question") return decideSeedQuestion({ project, id, verdict: verdict === "take" ? "yes" : "no", guideHumanId });
  if (kind === "card") {
    const rows = await query<[FileRef[]]>(`SELECT * FROM file_refs WHERE id = $rid`, { rid: new RecordId("file_refs", id) });
    const card = rows?.[0]?.[0] ? formatRecord(rows[0][0] as unknown as FileRef) : null;
    if (!card || !card.suggestion || card.project_folder_id !== project._id || !card.date) {
      return { ok: false, error: "That suggestion isn't on this project." };
    }
    const content = card.content ?? "";
    await merge("file_refs", id, verdict === "take" ? { taken_content: content, decided_by: guideHumanId } : { passed_content: content, decided_by: guideHumanId });
    // Taking feeds the words now; passing after an earlier take keeps
    // what was taken, which is already in.
    if (verdict === "take") await runDailyLogSync(project._id, { date: card.date });
    return { ok: true };
  }
  const mark = await getMark(id);
  if (!mark || !mark.suggestion || mark.project_folder_id !== project._id) {
    return { ok: false, error: "That suggestion isn't on this project." };
  }
  if (mark.suggestion !== "pending") return { ok: false, error: "A Guide already decided that one." };
  await merge("graphlog_marks", id, { suggestion: verdict === "take" ? "taken" : "passed", decided_by: guideHumanId });
  if (verdict === "take") await syncMarksProjection(project);
  return { ok: true };
}
