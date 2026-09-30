/**
 * Seed packets, seeding rounds, and the questions sowing raises (Austin,
 * 2026-09-30: "anyone on a project can fill a seed packet, and a guide
 * sows it into seed").
 *
 * A seeding round is a stretch when the project takes in a backlog: a
 * new project opens with one, and a guide opens another when a new
 * person, a new phase or a big batch of information calls for it. While
 * a round is open, each person on the project has a seed packet: the
 * files they chose to add, as they added them.
 *
 * A PACKET IS ROWS, NOT A FOLDER. The guide asked for a system folder
 * under Syncs; three things in the code rule that out. sync-knowledge
 * describes every file under `Syncs/` on every run, so a packet would be
 * read before anyone pressed Sow. Every folder under a project carries
 * the project's `shared_with`, rewritten on each people change, so
 * Crafters and Observers would see every packet in the Vault. And a
 * project-view reset deletes any project child that is not skills, syncs
 * or graph. So a packet's files are rows here, keyed by project, person
 * and round, with the bytes in storage (or inline for text) and no Vault
 * file at all. One route serves them, to the uploader and the project's
 * Guides, and nothing else can reach what nothing else knows exists.
 *
 * Each file is read once. `sown_at` is stamped when the sow stage has
 * turned it into seed (`sow.server.ts`); the same name added again with
 * different bytes is a new row, and so is new.
 *
 * A question is a line the stage would not settle alone: who said it,
 * whether a Card already says it, or when it was said. It waits for a
 * Guide's yes or no in the Suggestions tab. Code writes the question;
 * a person answers it; the answer edits one day of the seed.
 *
 * This module only keeps the rows. Who may read or write them is the
 * routes' to check; what an answer does is `decideSeedQuestion`.
 */

import { RecordId } from "surrealdb";
import { defineTable, formatRecord, merge, newRecordId, query, remove, upsert, type Data } from "./generic.server";

const ROUNDS = "seed_rounds";
const FILES = "seed_packet_files";
const QUESTIONS = "seed_questions";

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  // Selecting from a table SurrealDB has never seen is an error, and the
  // project page reads all three before anyone has opened a round.
  await Promise.all([defineTable(ROUNDS), defineTable(FILES), defineTable(QUESTIONS)]);
  tablesEnsured = true;
}

async function rows<T extends Data>(sql: string, vars: Record<string, unknown>): Promise<T[]> {
  await ensureTables();
  const result = await query<[T[]]>(sql, vars);
  return (result?.[0] ?? []).map((r) => formatRecord(r));
}

// ─── Rounds ─────────────────────────────────────────────────────────────

export type SeedRound = Data & {
  _id: string;
  project_folder_id: string;
  round: number;
  opened_at: string;
  opened_by: string;
  closed_at: string | null;
  closed_by: string | null;
};

export async function listSeedRounds(projectFolderId: string): Promise<SeedRound[]> {
  return (await rows<SeedRound>(`SELECT * FROM ${ROUNDS} WHERE project_folder_id = $projectFolderId`, { projectFolderId })).sort(
    (a, b) => a.round - b.round,
  );
}

/** The round that is open now, or null. */
export async function currentSeedRound(projectFolderId: string): Promise<SeedRound | null> {
  return (await listSeedRounds(projectFolderId)).find((r) => !r.closed_at) ?? null;
}

/** Opens a round, or returns the one already open. */
export async function openSeedRound(projectFolderId: string, humanId: string): Promise<SeedRound> {
  const all = await listSeedRounds(projectFolderId);
  const open = all.find((r) => !r.closed_at);
  if (open) return open;
  const round = (all[all.length - 1]?.round ?? 0) + 1;
  const row = { project_folder_id: projectFolderId, round, opened_at: new Date().toISOString(), opened_by: humanId, closed_at: null, closed_by: null };
  // One id per project and round: two guides pressing at once make one.
  const result = await upsert(new RecordId(ROUNDS, `${projectFolderId}_${round}`), row);
  const record = Array.isArray(result) ? result[0] : result;
  return formatRecord(record as unknown as SeedRound);
}

/** Closes the open round. Null when none was open. */
export async function endSeedRound(projectFolderId: string, humanId: string): Promise<SeedRound | null> {
  const open = await currentSeedRound(projectFolderId);
  if (!open) return null;
  await merge(ROUNDS, open._id, { closed_at: new Date().toISOString(), closed_by: humanId });
  return { ...open, closed_at: new Date().toISOString(), closed_by: humanId };
}

// ─── Packet files ───────────────────────────────────────────────────────

export type SeedPacketFile = Data & {
  _id: string;
  project_folder_id: string;
  round: number;
  /** Who added it. The packet is theirs. */
  human_id: string;
  name: string;
  content_type: string;
  size: number;
  content_hash: string;
  s3_key: string | null;
  s3_url: string | null;
  /** The text itself, for a file that is text. */
  content: string | null;
  created_at: string;
  /** When the sow stage turned it into seed; null while it waits. */
  sown_at: string | null;
  /** The seed days it wrote to. */
  sown_days: string[];
  /** The seed document it became, for a standalone file. */
  sown_file_id: string | null;
};

const TEXT_EXTENSIONS = /\.(md|markdown|txt|text|eml|csv|tsv|json|html?|vtt|srt|log|rtf)$/i;

/** Whether a packet file is read as text by the sow stage. Anything else
 * (a PDF, a photo) is kept as a document as it is. */
export function isPacketText(name: string, contentType: string): boolean {
  return contentType.startsWith("text/") || contentType === "application/json" || contentType === "message/rfc822" || TEXT_EXTENSIONS.test(name);
}

export async function addPacketFile(input: Omit<SeedPacketFile, "_id" | "id" | "created_at" | "sown_at" | "sown_days" | "sown_file_id">): Promise<{ file: SeedPacketFile; outcome: "added" | "already" }> {
  // The same bytes under the same name from the same person are the same
  // file: pressing Add twice adds once.
  const existing = (
    await rows<SeedPacketFile>(`SELECT * FROM ${FILES} WHERE project_folder_id = $p AND human_id = $h AND name = $n AND content_hash = $c`, {
      p: input.project_folder_id,
      h: input.human_id,
      n: input.name,
      c: input.content_hash,
    })
  )[0];
  if (existing) return { file: existing, outcome: "already" };
  const row = { ...input, created_at: new Date().toISOString(), sown_at: null, sown_days: [], sown_file_id: null };
  const result = await upsert(new RecordId(FILES, newRecordId()), row);
  const record = Array.isArray(result) ? result[0] : result;
  return { file: formatRecord(record as unknown as SeedPacketFile), outcome: "added" };
}

/** A project's packet files, oldest first; one person's when `humanId` is given. */
export async function listPacketFiles(projectFolderId: string, humanId?: string): Promise<SeedPacketFile[]> {
  const mine = humanId ? "AND human_id = $humanId" : "";
  return (await rows<SeedPacketFile>(`SELECT * FROM ${FILES} WHERE project_folder_id = $projectFolderId ${mine}`, { projectFolderId, humanId })).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

export async function getPacketFile(id: string): Promise<SeedPacketFile | null> {
  return (await rows<SeedPacketFile>(`SELECT * FROM ${FILES} WHERE id = $rid`, { rid: new RecordId(FILES, id) }))[0] ?? null;
}

export async function removePacketFile(id: string): Promise<void> {
  await ensureTables();
  await remove(FILES, id);
}

export async function markPacketSown(id: string, sown: { days: string[]; fileId?: string | null }): Promise<void> {
  await merge(FILES, id, { sown_at: new Date().toISOString(), sown_days: sown.days, sown_file_id: sown.fileId ?? null });
}

/** Every day a sowing has written to. The push refuses to replace these. */
export async function sownSeedDays(projectFolderId: string): Promise<Set<string>> {
  return new Set((await listPacketFiles(projectFolderId)).flatMap((f) => f.sown_days ?? []));
}

/** After a seed wipe: every packet file waits again, so Sow rebuilds
 * the seed from the packets. The second copy of "this was sown" is
 * cleared with the first. */
export async function clearSownForProject(projectFolderId: string): Promise<number> {
  const sown = (await listPacketFiles(projectFolderId)).filter((f) => f.sown_at);
  for (const f of sown) await merge(FILES, f._id, { sown_at: null, sown_days: [], sown_file_id: null });
  return sown.length;
}

// ─── Questions ──────────────────────────────────────────────────────────

export type SeedQuestionKind = "who" | "logged" | "when";
export type SeedQuestionStatus = "pending" | "yes" | "no";

export type SeedQuestion = Data & {
  _id: string;
  project_folder_id: string;
  packet_file_id: string;
  kind: SeedQuestionKind;
  /** The day the line belongs to (the model's estimate for `when`). */
  date: string;
  /** The line itself, as the file has it. */
  text: string;
  /** The `- src:` line it would carry. */
  src: string;
  /** Who the stage thinks said it; null for a noted fact. */
  speaker: string | null;
  /** Whether the speaker is settled, so a `logged` or `when` no/yes
   * knows to place the line under the name or under Noted. */
  speaker_settled: boolean;
  /** For `logged`: the Card it matches. */
  card: { date: string; humanId: string; name: string } | null;
  status: SeedQuestionStatus;
  decided_by: string | null;
  created_at: string;
};

export async function createSeedQuestion(input: Omit<SeedQuestion, "_id" | "id" | "status" | "decided_by" | "created_at">): Promise<SeedQuestion | null> {
  // One question per line per kind: a file sown again after a wipe asks
  // again only what is not already waiting.
  const waiting = await rows<SeedQuestion>(`SELECT * FROM ${QUESTIONS} WHERE project_folder_id = $p AND kind = $k AND text = $t AND status = "pending"`, {
    p: input.project_folder_id,
    k: input.kind,
    t: input.text,
  });
  if (waiting.length > 0) return null;
  const row = { ...input, status: "pending" as const, decided_by: null, created_at: new Date().toISOString() };
  const result = await upsert(new RecordId(QUESTIONS, newRecordId()), row);
  const record = Array.isArray(result) ? result[0] : result;
  return formatRecord(record as unknown as SeedQuestion);
}

export async function listSeedQuestions(projectFolderId: string, status?: SeedQuestionStatus): Promise<SeedQuestion[]> {
  const byStatus = status ? "AND status = $status" : "";
  return (await rows<SeedQuestion>(`SELECT * FROM ${QUESTIONS} WHERE project_folder_id = $projectFolderId ${byStatus}`, { projectFolderId, status })).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export async function getSeedQuestion(id: string): Promise<SeedQuestion | null> {
  return (await rows<SeedQuestion>(`SELECT * FROM ${QUESTIONS} WHERE id = $rid`, { rid: new RecordId(QUESTIONS, id) }))[0] ?? null;
}

export async function setSeedQuestionDecided(id: string, status: "yes" | "no", guideHumanId: string): Promise<void> {
  await merge(QUESTIONS, id, { status, decided_by: guideHumanId });
}

/** After a seed wipe: the questions were about seed that is gone. */
export async function deleteSeedQuestionsForProject(projectFolderId: string): Promise<void> {
  await ensureTables();
  await query(`DELETE ${QUESTIONS} WHERE project_folder_id = $projectFolderId`, { projectFolderId });
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** The question as a guide reads it. Each kind has its own yes and no
 * (the seed packets guide, "The questions"). */
export function seedQuestionSentence(q: Pick<SeedQuestion, "kind" | "speaker" | "date" | "card">): string {
  if (q.kind === "who") return `I think this is ${q.speaker}. Is it?`;
  if (q.kind === "logged") return `This matches ${q.card?.name ?? "someone"}'s ${shortDate(q.card?.date ?? q.date)} Card. Skip it?`;
  return `Is this from about ${shortDate(q.date)}?`;
}

/** What each answer does, in a line, under the buttons. */
export function seedQuestionMeaning(q: Pick<SeedQuestion, "kind" | "speaker">): { yes: string; no: string } {
  if (q.kind === "who") return { yes: `Yes puts it under ${q.speaker}.`, no: "No leaves it as a noted fact, nobody's words." };
  if (q.kind === "logged") return { yes: "Yes leaves it out.", no: "No puts it in the seed." };
  return { yes: "Yes puts it on that day.", no: "No leaves it out for you to date by hand." };
}
