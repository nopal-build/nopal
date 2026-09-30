/**
 * Seeding: a project's history before it logged in O.No, taken in as
 * its own kind of thing (Austin, 2026-09-29: "these look different than
 * a daily log, some method the system knows what they are"), and built
 * into the same graph by the same stages. The first project is Campbell
 * (This Healthy House); the folder is built by hand in the vault and
 * pushed with `nopal graphlog seed`.
 *
 * What a seed is. A folder of day files `YYYY-MM-DD.md` with `kind: seed`
 * in their front matter, each holding one `## <Name>` section per person
 * with their own words verbatim, grouped by source with a `- src:` line
 * under each group, and then `## Noted (not anyone's words)` for facts
 * worth keeping that nobody said in those words. Beside them
 * `documents/` (`kind: seed-document`, dated, with an `author:` line),
 * `_people.md` (one line per name used, with a role) and `_attachments.md`
 * (which files belong to which day). `_review*` files and `_to_delete/`
 * are the seeder's own and never come in.
 *
 * Where it lands: `Syncs/Seed/` in the project, a system folder like
 * `Syncs/Marks/`. A day file keeps its name, gets `date` stamped so
 * `sync-graph` groups it with that day's live entries, and gets a
 * `content_hash` so a second push of the same file changes nothing. It
 * is nobody's Card and nobody's daily log: it never touches `Daily Logs/`.
 *
 * How the graph reads it. `sync-graph` recognises the Seed folder by id
 * and, instead of treating the file as one source under one name, splits
 * a day into one source per section by code (`buildSeedDaySources`): a
 * spoken section is that person's words, cited under their name with
 * `origin="seed"` and their human id when the name links to someone on
 * the project; the noted section is cited as "Seed" with
 * `origin="seed-noted"`, never highlighted, and every noted bullet the
 * model passes over is written verbatim by code, the rule marks already
 * follow. The seeder's `- src:` lines are provenance, not words: they are
 * lifted out of the text the model reads and listed in the source label.
 *
 * Who links a name to an account: code, by exact first name against the
 * project's members (`linkSeedNames`). Nothing here invites anyone or
 * makes an account; a name that matches nobody stays a name. The links a
 * day was written with go into that day's source hash, so when someone
 * joins later and is put on the project, only the days where they speak
 * re-extract on the next run.
 *
 * The wipe (`wipeSeed`, admins only) removes what seed alone added: the
 * Seed folder with everything in it, the graph day files of dates that
 * had no other source, and the `sourceHash` of dates that mix seed and
 * live entries so the next run re-extracts them from the live entries
 * alone. graph-structure drops the ids that vanished; the Efforts page
 * keeps the words until the next run rewrites it. Cards, `Daily Logs/`,
 * marks and the Budget are never touched.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildRefDirectiveMarkdown, type RefAttrs } from "oxmarkdown-core";
import { joinReadmeSections, splitFrontmatter, splitReadmeSections } from "./project.types";
import { GRAPH_STRUCTURE_FILE, nodeIdsInSection, pruneStaleMembership } from "./graphStructure.server";
import type { GraphLogNode } from "./graphNodeIndex.server";
import { DAILY_LOGS_SYNC_FOLDER_NAME, ensureProjectSyncsFolder } from "./dailyLogSync.server";
import { firstName } from "./humanNames";
import { getHumansById } from "./humans.server";
import { getProjectSharing } from "./projectSharing.server";
import { findProjectGraphFolder } from "./projectN02.server";
import { KNOWLEDGE_FOLDER_NAME } from "./syncKnowledge.server";
import { clearSownForProject, deleteSeedQuestionsForProject, sownSeedDays } from "./seedPackets.server";
import {
  createFileRef,
  createVaultFolder,
  deleteFileRef,
  deleteVaultFolderCascade,
  getFileRefById,
  getFileRefsByFolderIds,
  listFolderChildren,
  systemVaultFolderKey,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";

export const SEED_SYNC_FOLDER_NAME = "Seed";
export const SEED_DOCUMENTS_FOLDER_NAME = "documents";
export const SEED_PEOPLE_FILE_NAME = "_people.md";
/** The heading a seed day uses for facts nobody said in those words. */
export const SEED_NOTED_HEADING = "Noted (not anyone's words)";
/** The citation name a noted line carries: never a person. */
export const SEED_NOTED_NAME = "Seed";
/** Written by code into a noted node's own text, the way a description-
 * only photo node says what it is, so every later reader knows without
 * being told the rule. */
export const SEED_NOTED_PROVENANCE =
  "*Noted when this history was seeded. Not a quotation, and not anyone's words.*";

export const SEED_DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAPH_DAY_RE = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/;
const SRC_LINE_RE = /^\s*-\s*src:\s*(.*)$/;

/** Whether a heading is the noted section: "Noted" in any case, with or
 * without the parenthetical. A near miss would otherwise become a
 * speaker called "Noted", its facts highlighted as that person's words.
 * Pure. */
export function isNotedHeading(heading: string): boolean {
  return /^noted\b/i.test(heading.trim());
}

export function isSeedDayFileName(name: string): boolean {
  return SEED_DAY_FILE_RE.test(name);
}

/** A file the seed folder holds for the intake, never for the graph or
 * the describer: `_people.md`, `_attachments.md`, anything underscored. */
export function isSeedInstructionFileName(name: string): boolean {
  return name.startsWith("_");
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readFrontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (!frontmatter) return { data: {}, body };
  try {
    const data = parseYaml(frontmatter) as Record<string, unknown> | null;
    return { data: data && typeof data === "object" ? data : {}, body };
  } catch {
    return { data: {}, body };
  }
}

// ─── Parsing a seed day ─────────────────────────────────────────────────

export type SeedSection = {
  /** The heading, as the seeder wrote it: a person's name. */
  speaker: string;
  /** Their words, with the `- src:` lines taken out. */
  text: string;
  /** The `- src:` lines, in order, deduplicated. */
  sources: string[];
};

export type SeedDay = {
  kind: string | null;
  sections: SeedSection[];
  /** The noted section: its text, and each top-level bullet on its own
   * for the verbatim fallback. Null when the day has none. */
  noted: { text: string; bullets: string[] } | null;
};

/** Top-level bullets of a markdown list, continuation lines joined. */
export function topLevelBullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const top = /^-\s+(.*)$/.exec(line);
    if (top) {
      out.push(top[1].trim());
    } else if (out.length > 0 && line.trim()) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    }
  }
  return out.filter(Boolean);
}

/** Splits one seed day into its sections. Pure. */
export function parseSeedDay(markdown: string): SeedDay {
  const { data, body } = readFrontmatter(markdown);
  const kind = typeof data.kind === "string" ? data.kind : null;
  const sections: SeedSection[] = [];
  let noted: { text: string; bullets: string[] } | null = null;

  let heading: string | null = null;
  let lines: string[] = [];
  let sources: string[] = [];
  const flush = () => {
    if (heading === null) return;
    const text = lines.join("\n").trim();
    if (isNotedHeading(heading)) {
      if (text) noted = { text, bullets: topLevelBullets(text) };
    } else if (text) {
      sections.push({ speaker: heading, text, sources: [...new Set(sources)] });
    }
  };
  for (const line of body.split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      heading = h2[1];
      lines = [];
      sources = [];
      continue;
    }
    if (heading === null) continue;
    const src = SRC_LINE_RE.exec(line);
    if (src) {
      if (src[1].trim()) sources.push(src[1].trim());
      continue;
    }
    lines.push(line);
  }
  flush();
  return { kind, sections, noted };
}

// ─── A seed day as groups, for merging ──────────────────────────────────
//
// `parseSeedDay` above is what the graph reads: a section's words with
// the `- src:` lines lifted out. Adding to a day that already exists (a
// second seed packet, or a guide's yes to a question) needs the other
// view: which bullets sit under which `- src:` line, so new lines can be
// added under their own source and nothing already there is touched.

/** Bullets that share one `- src:` line. A bullet is kept as written,
 * its own sub-bullets included. */
export type SeedGroup = { bullets: string[]; src: string | null };

export type SeedDayDoc = {
  /** The front matter's text, kept byte for byte; null when there is none. */
  frontmatter: string | null;
  sections: { speaker: string; groups: SeedGroup[] }[];
  /** The noted section's bullets, as written. */
  noted: string[];
};

/** A bullet and a candidate line compared as words: whitespace
 * collapsed, the leading marker aside. */
export function seedBulletKey(text: string): string {
  return text.replace(/^[ \t]*[-*][ \t]+/gm, " ").replace(/\s+/g, " ").trim();
}

/** Reads a seed day into sections, groups and bullets. Pure. */
export function parseSeedDayDoc(markdown: string): SeedDayDoc {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const doc: SeedDayDoc = { frontmatter, sections: [], noted: [] };
  let heading: string | null = null;
  let groups: SeedGroup[] = [];
  let bullets: string[] = [];
  const closeGroup = (src: string | null) => {
    if (bullets.length > 0) groups.push({ bullets, src });
    bullets = [];
  };
  const closeSection = () => {
    if (heading === null) return;
    if (isNotedHeading(heading)) {
      doc.noted.push(...groups.flatMap((g) => g.bullets), ...bullets);
    } else {
      closeGroup(null);
      if (groups.length > 0) doc.sections.push({ speaker: heading, groups });
    }
    groups = [];
    bullets = [];
  };
  for (const line of body.split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      closeSection();
      heading = h2[1];
      continue;
    }
    if (heading === null) continue;
    const src = SRC_LINE_RE.exec(line);
    if (src && /^\s+/.test(line)) {
      closeGroup(src[1].trim() || null);
      continue;
    }
    const top = /^-\s+(.*)$/.exec(line);
    if (top) bullets.push(top[1].trimEnd());
    else if (line.trim() && bullets.length > 0) bullets[bullets.length - 1] = `${bullets[bullets.length - 1]}\n${line.trimEnd()}`;
  }
  closeSection();
  return doc;
}

/** Writes a seed day back in the shape `parseSeedDay` reads. Pure. */
export function renderSeedDayDoc(doc: SeedDayDoc): string {
  const blocks: string[] = [];
  for (const section of doc.sections) {
    const groups = section.groups
      .filter((g) => g.bullets.length > 0)
      .map((g) => [...g.bullets.map((b) => `- ${b}`), g.src ? `  - src: ${g.src}` : null].filter((l) => l !== null).join("\n"));
    if (groups.length > 0) blocks.push(`## ${section.speaker}\n\n${groups.join("\n\n")}`);
  }
  if (doc.noted.length > 0) blocks.push(`## ${SEED_NOTED_HEADING}\n\n${doc.noted.map((b) => `- ${b}`).join("\n")}`);
  const body = `${blocks.join("\n\n")}\n`;
  return doc.frontmatter === null ? body : `---\n${doc.frontmatter}\n---\n\n${body}`;
}

export type SeedAddition = {
  lines: { speaker: string; text: string; src: string | null }[];
  noted: string[];
};

/** Adds lines to a seed day without touching what is there: a line
 * already in the day (under anyone, or noted) is not written twice, a
 * new line goes under its speaker in a group with its own source, and a
 * day that does not exist yet is made. Returns the content and how many
 * lines went in. Pure. */
export function mergeSeedDay(
  existing: string | null,
  date: string,
  addition: SeedAddition,
): { content: string; added: number; skipped: number } {
  const doc: SeedDayDoc = existing
    ? parseSeedDayDoc(existing)
    : { frontmatter: `date: ${date}\nkind: seed\nsource: seed packets`, sections: [], noted: [] };
  const present = new Set<string>([
    ...doc.sections.flatMap((s) => s.groups.flatMap((g) => g.bullets.map(seedBulletKey))),
    ...doc.noted.map(seedBulletKey),
  ]);
  let added = 0;
  let skipped = 0;
  for (const line of addition.lines) {
    const key = seedBulletKey(line.text);
    if (!key || present.has(key)) {
      skipped += 1;
      continue;
    }
    present.add(key);
    let section = doc.sections.find((s) => s.speaker.toLowerCase() === line.speaker.trim().toLowerCase());
    if (!section) {
      section = { speaker: line.speaker.trim(), groups: [] };
      doc.sections.push(section);
    }
    // The last group when it carries the same source, else a new one: a
    // packet's lines sit together under the packet's own src line.
    const last = section.groups[section.groups.length - 1];
    if (last && last.src === line.src) last.bullets.push(key);
    else section.groups.push({ bullets: [key], src: line.src });
    added += 1;
  }
  for (const text of addition.noted) {
    const key = seedBulletKey(text);
    if (!key || present.has(key)) {
      skipped += 1;
      continue;
    }
    present.add(key);
    doc.noted.push(key);
    added += 1;
  }
  return { content: renderSeedDayDoc(doc), added, skipped };
}

/** Moves one noted line under a person (a guide's yes to "who said
 * this?"). Returns the content unchanged when the line is not in the
 * day's Noted section any more. Pure. */
export function moveNotedToSpeaker(content: string, text: string, speaker: string, src: string | null): string {
  const doc = parseSeedDayDoc(content);
  const key = seedBulletKey(text);
  const idx = doc.noted.findIndex((b) => seedBulletKey(b) === key);
  if (idx === -1) return content;
  doc.noted.splice(idx, 1);
  let section = doc.sections.find((s) => s.speaker.toLowerCase() === speaker.trim().toLowerCase());
  if (!section) {
    section = { speaker: speaker.trim(), groups: [] };
    doc.sections.push(section);
  }
  const last = section.groups[section.groups.length - 1];
  if (last && last.src === src) last.bullets.push(key);
  else section.groups.push({ bullets: [key], src });
  return renderSeedDayDoc(doc);
}

/** `_people.md`: one line per name, `- Name — role`. Pure. */
export function parseSeedPeople(markdown: string): Map<string, string> {
  const roles = new Map<string, string>();
  for (const line of readFrontmatter(markdown).body.split("\n")) {
    const m = /^-\s+(.+?)\s+(?:—|–|-)\s+(.+?)\s*$/.exec(line);
    if (m) roles.set(m[1].trim(), m[2].trim());
  }
  return roles;
}

/** A seed document's front matter, as the intake and the graph read it. */
export type SeedDocumentMeta = {
  kind: string | null;
  date: string | null;
  author: string | null;
  body: string;
};

export function parseSeedDocument(markdown: string): SeedDocumentMeta {
  const { data, body } = readFrontmatter(markdown);
  const dateRaw = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date;
  return {
    kind: typeof data.kind === "string" ? data.kind : null,
    date: typeof dateRaw === "string" && DATE_RE.test(dateRaw) ? dateRaw : null,
    author: typeof data.author === "string" && data.author.trim() ? data.author.trim() : null,
    body,
  };
}

// ─── Linking names to accounts ─────────────────────────────────────────

export type SeedMember = { humanId: string; name: string; email: string };

/** Which seed names are people on the project, by exact first name (or
 * the whole name), case-insensitive. A name two members share links to
 * nobody, and is reported. Pure. */
export function linkSeedNames(
  names: Iterable<string>,
  members: readonly SeedMember[],
): { links: Map<string, string | null>; ambiguous: string[] } {
  const links = new Map<string, string | null>();
  const ambiguous: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || links.has(name)) continue;
    const wanted = name.toLowerCase();
    const wantedFirst = firstName({ name, email: "" }).toLowerCase();
    const matches = members.filter((m) => {
      const full = (m.name ?? "").trim().toLowerCase();
      const first = firstName({ name: m.name, email: m.email }).toLowerCase();
      return full === wanted || first === wantedFirst;
    });
    const distinct = [...new Set(matches.map((m) => m.humanId))];
    if (distinct.length === 1) links.set(name, distinct[0]);
    else {
      links.set(name, null);
      if (distinct.length > 1) ambiguous.push(name);
    }
  }
  return { links, ambiguous };
}

/** The project's members with the names the graph will cite. */
export async function seedMembers(projectFolder: VaultFolder): Promise<SeedMember[]> {
  const sharing = await getProjectSharing(projectFolder);
  const humans = await getHumansById([...new Set(sharing.map((e) => e.human))]);
  return humans.map((h) => ({ humanId: h._id, name: h.name, email: h.email }));
}

// ─── What sync-graph reads from a seed file ─────────────────────────────

export type SeedSource = {
  /** The label after `Source N: `, code-written. */
  label: string;
  /** What the model reads under `Content:`. */
  content: string;
  ref: RefAttrs;
  /** Whether the words are a person's own (highlighted when quoted). */
  humanAuthored: boolean;
  /** For the noted section: each bullet, so any the model passes over is
   * written verbatim by code. Null for a spoken section. */
  verbatimFallback: string[] | null;
  /** The link this source was written with, for the day's hash. */
  hashPart: string;
};

/** The sources one seed day becomes, one per section, plus the noted
 * section last. Pure: the caller supplies the links and the names. */
export function buildSeedDaySources(input: {
  date: string;
  fileId: string;
  day: SeedDay;
  links: ReadonlyMap<string, string | null>;
  /** Display names of linked members, by human id. */
  memberNames: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
}): SeedSource[] {
  const out: SeedSource[] = [];
  const location = `/vault?file=${input.fileId}`;
  const datetime = `${input.date}T12:00:00Z`;
  for (const section of input.day.sections) {
    const humanId = input.links.get(section.speaker) ?? null;
    const name = (humanId && input.memberNames.get(humanId)) || section.speaker;
    const role = input.roles.get(section.speaker);
    const sources = section.sources.length > 0 ? `; from: ${section.sources.join("; ")}` : "";
    out.push({
      label: `"${input.date}, ${section.speaker}'s own words" (by ${name}${role ? `, ${role}` : ""}; seeded history taken from records, not a daily log${sources})`,
      content: section.text,
      ref: { name, humanId: humanId ?? undefined, datetime, location, verbose: true, origin: "seed" },
      humanAuthored: true,
      verbatimFallback: null,
      hashPart: `seedlink:${section.speaker}=${humanId ?? "none"}`,
    });
  }
  if (input.day.noted) {
    out.push({
      label: `"${input.date}, noted at seeding" (facts kept from records that nobody said in these words; not a quotation, never attribute them to a person)`,
      content: input.day.noted.text,
      ref: { name: SEED_NOTED_NAME, datetime, location, verbose: true, origin: "seed-noted" },
      humanAuthored: false,
      verbatimFallback: input.day.noted.bullets,
      hashPart: "seednoted",
    });
  }
  return out;
}

/** One seed document as a source: the author's own words, under their
 * name, linked when the author is on the project. Pure. */
export function buildSeedDocumentSource(input: {
  fileId: string;
  name: string;
  meta: SeedDocumentMeta;
  links: ReadonlyMap<string, string | null>;
  memberNames: ReadonlyMap<string, string>;
  /** The file's own stamped date, for a document whose front matter has
   * none (edited in the Vault after the push). Never an empty date. */
  fileDate?: string;
}): SeedSource {
  const author = input.meta.author ?? SEED_NOTED_NAME;
  const humanId = input.meta.author ? input.links.get(input.meta.author) ?? null : null;
  const name = (humanId && input.memberNames.get(humanId)) || author;
  const date = input.meta.date ?? input.fileDate ?? "";
  const humanAuthored = !!input.meta.author;
  return {
    label: `"${input.name}" (a document seeded with the project's history${input.meta.author ? `, written by ${name}` : ", author unknown"}; dated ${date})`,
    content: input.meta.body,
    ref: {
      name,
      humanId: humanId ?? undefined,
      datetime: `${date}T12:00:00Z`,
      location: `/vault?file=${input.fileId}`,
      verbose: true,
      origin: humanAuthored ? "seed" : "seed-noted",
    },
    humanAuthored,
    verbatimFallback: null,
    hashPart: `seedlink:${author}=${humanId ?? "none"}`,
  };
}

export function seedRefMarkdown(ref: RefAttrs): string {
  return buildRefDirectiveMarkdown(ref);
}

// ─── The folder ─────────────────────────────────────────────────────────

export async function findSeedSyncFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return null;
  const { folders: syncFolders } = await listFolderChildren(projectFolder.human_id, syncs._id);
  return syncFolders.find((f) => f.name === SEED_SYNC_FOLDER_NAME) ?? null;
}

async function ensureSeedSyncFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const syncsFolder = await ensureProjectSyncsFolder(projectFolder);
  const { folders } = await listFolderChildren(projectFolder.human_id, syncsFolder._id);
  const existing = folders
    .filter((f) => f.name === SEED_SYNC_FOLDER_NAME)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: SEED_SYNC_FOLDER_NAME,
    parent_folder_id: syncsFolder._id,
    id: systemVaultFolderKey(projectFolder.human_id, SEED_SYNC_FOLDER_NAME, syncsFolder._id),
  });
  if (!created) throw new Error("Failed to create the project's syncs/Seed folder");
  return created;
}

async function ensureChildFolder(humanId: string, parent: VaultFolder, name: string): Promise<VaultFolder> {
  const { folders } = await listFolderChildren(humanId, parent._id);
  const existing = folders.filter((f) => f.name === name).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: humanId,
    name,
    parent_folder_id: parent._id,
    id: systemVaultFolderKey(humanId, name, parent._id),
  });
  if (!created) throw new Error(`Failed to create the project's syncs/Seed/${name} folder`);
  return created;
}

/** The Seed folder's `documents/` child, when the folder exists. */
export async function findSeedDocumentsFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const seed = await findSeedSyncFolder(projectFolder);
  if (!seed) return null;
  const { folders } = await listFolderChildren(projectFolder.human_id, seed._id);
  return folders.find((f) => f.name === SEED_DOCUMENTS_FOLDER_NAME) ?? null;
}

// ─── The push ───────────────────────────────────────────────────────────

export type SeedPayload = {
  days: { date: string; content: string }[];
  documents: { name: string; content: string }[];
  people?: string | null;
};

export type SeedFileOutcome = "written" | "updated" | "unchanged";

export type SeedApplyReport = {
  days: { written: string[]; updated: string[]; unchanged: string[]; skipped: { name: string; reason: string }[] };
  documents: { written: string[]; updated: string[]; unchanged: string[]; skipped: { name: string; reason: string }[] };
  people: SeedFileOutcome | "none";
  /** Every name the pushed days speak under, and who it links to. */
  links: { name: string; humanId: string | null; linkedName: string | null }[];
  ambiguous: string[];
  /** Pushed dates that already have live synced entries: the check for
   * "the seed repeats what someone logged" starts here. */
  liveOnSameDay: { date: string; sources: number }[];
};

function inRange(date: string, from?: string | null, to?: string | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Which of the payload's days a push with this range takes. Pure. */
export function selectSeedDays<T extends { date: string }>(days: readonly T[], range: { from?: string | null; to?: string | null }): T[] {
  return days.filter((d) => DATE_RE.test(d.date) && inRange(d.date, range.from, range.to)).sort((a, b) => a.date.localeCompare(b.date));
}

async function writeSeedFile(input: {
  humanId: string;
  folder: VaultFolder;
  existing: Map<string, { _id: string; content_hash: string | null | undefined; date: string | undefined }>;
  name: string;
  content: string;
  date: string | null;
}): Promise<SeedFileOutcome> {
  const hash = contentHash(input.content);
  const existing = input.existing.get(input.name);
  if (existing && existing.content_hash === hash) {
    if (input.date && existing.date !== input.date) await updateFileRef(existing._id, { date: input.date });
    return "unchanged";
  }
  if (existing) {
    await updateFileRef(existing._id, { content: input.content, content_hash: hash, ...(input.date ? { date: input.date } : {}) });
    return "updated";
  }
  const created = await createFileRef({
    human_id: input.humanId,
    name: input.name,
    content: input.content,
    content_type: "text/markdown",
    content_hash: hash,
    folder_id: input.folder._id,
    ...(input.date ? { date: input.date } : {}),
  });
  if (!created) throw new Error(`Failed to write ${input.name}`);
  input.existing.set(input.name, { _id: created._id, content_hash: hash, date: input.date ?? undefined });
  return "written";
}

async function listingByName(humanId: string, folderId: string) {
  const { files } = await listFolderChildren(humanId, folderId);
  return new Map(files.map((f) => [f.name, { _id: f._id, content_hash: f.content_hash, date: f.date }]));
}

/** Takes a seed payload into `Syncs/Seed/`. Only the days and documents
 * dated in range are written ("7/20 alone" means 7/20 alone); the people
 * file always is. Never writes under `Daily Logs/` or `Marks/`. */
export async function applySeed(
  projectFolder: VaultFolder,
  payload: SeedPayload,
  range: { from?: string | null; to?: string | null } = {},
): Promise<SeedApplyReport> {
  const humanId = projectFolder.human_id;
  const report: SeedApplyReport = {
    days: { written: [], updated: [], unchanged: [], skipped: [] },
    documents: { written: [], updated: [], unchanged: [], skipped: [] },
    people: "none",
    links: [],
    ambiguous: [],
    liveOnSameDay: [],
  };

  const seedFolder = await ensureSeedSyncFolder(projectFolder);
  const seedFiles = await listingByName(humanId, seedFolder._id);

  const spoken = new Set<string>();
  const days = selectSeedDays(payload.days, range);
  // A push replaces a day by name. A day a seed packet has written to
  // holds lines the pushed file does not have, so replacing it would
  // erase them without a word: that day is refused and named.
  const sown = await sownSeedDays(projectFolder._id);
  for (const day of days) {
    if (sown.has(day.date) && seedFiles.get(`${day.date}.md`)?.content_hash !== contentHash(day.content)) {
      report.days.skipped.push({ name: `${day.date}.md`, reason: "a seed packet has added to this day; a push would replace those lines" });
      continue;
    }
    const parsed = parseSeedDay(day.content);
    if (parsed.kind !== "seed") {
      report.days.skipped.push({ name: `${day.date}.md`, reason: "front matter is not `kind: seed`" });
      continue;
    }
    if (parsed.sections.length === 0 && !parsed.noted) {
      report.days.skipped.push({ name: `${day.date}.md`, reason: "no sections" });
      continue;
    }
    for (const s of parsed.sections) spoken.add(s.speaker);
    const outcome = await writeSeedFile({ humanId, folder: seedFolder, existing: seedFiles, name: `${day.date}.md`, content: day.content, date: day.date });
    report.days[outcome].push(day.date);
  }

  if (payload.documents.length > 0) {
    const docsFolder = await ensureChildFolder(humanId, seedFolder, SEED_DOCUMENTS_FOLDER_NAME);
    const docFiles = await listingByName(humanId, docsFolder._id);
    for (const doc of payload.documents) {
      const meta = parseSeedDocument(doc.content);
      if (meta.kind !== "seed-document") {
        report.documents.skipped.push({ name: doc.name, reason: "front matter is not `kind: seed-document`" });
        continue;
      }
      if (!meta.date) {
        report.documents.skipped.push({ name: doc.name, reason: "no `date:` in its front matter" });
        continue;
      }
      if (!inRange(meta.date, range.from, range.to)) {
        report.documents.skipped.push({ name: doc.name, reason: `dated ${meta.date}, outside the range` });
        continue;
      }
      if (meta.author) spoken.add(meta.author);
      const outcome = await writeSeedFile({ humanId, folder: docsFolder, existing: docFiles, name: doc.name, content: doc.content, date: meta.date });
      report.documents[outcome].push(doc.name);
    }
  }

  if (payload.people && payload.people.trim()) {
    report.people = await writeSeedFile({ humanId, folder: seedFolder, existing: seedFiles, name: SEED_PEOPLE_FILE_NAME, content: payload.people, date: null });
  }

  const members = await seedMembers(projectFolder);
  const { links, ambiguous } = linkSeedNames(spoken, members);
  const nameById = new Map(members.map((m) => [m.humanId, m.name]));
  report.links = [...links.entries()].map(([name, id]) => ({ name, humanId: id, linkedName: id ? nameById.get(id) ?? null : null }));
  report.ambiguous = ambiguous;

  // Live entries on the same dates: one listing of `Daily Logs/`.
  const { folders: syncFolders } = await listFolderChildren(humanId, seedFolder.parent_folder_id!);
  const daily = syncFolders.find((f) => f.name === DAILY_LOGS_SYNC_FOLDER_NAME);
  if (daily) {
    const { files } = await listFolderChildren(humanId, daily._id);
    const pushed = new Set(days.map((d) => d.date));
    const counts = new Map<string, number>();
    for (const f of files) if (f.date && pushed.has(f.date)) counts.set(f.date, (counts.get(f.date) ?? 0) + 1);
    report.liveOnSameDay = [...counts.entries()].sort().map(([date, sources]) => ({ date, sources }));
  }
  return report;
}

// ─── One day, one document: what the sow stage writes through ───────────

/** A seed day's file and its content, or null when the day has none. */
export async function readSeedDayFile(projectFolder: VaultFolder, date: string): Promise<{ fileId: string; content: string } | null> {
  const seed = await findSeedSyncFolder(projectFolder);
  if (!seed) return null;
  const { files } = await listFolderChildren(projectFolder.human_id, seed._id);
  const listing = files.find((f) => f.name === `${date}.md`);
  if (!listing) return null;
  const full = await getFileRefById(listing._id);
  return full ? { fileId: full._id, content: full.content ?? "" } : null;
}

/** Writes one seed day (made or replaced by name), stamped with its date
 * and hash exactly as a push stamps it. */
export async function writeSeedDayFile(projectFolder: VaultFolder, date: string, content: string): Promise<SeedFileOutcome> {
  const seedFolder = await ensureSeedSyncFolder(projectFolder);
  const existing = await listingByName(projectFolder.human_id, seedFolder._id);
  return writeSeedFile({ humanId: projectFolder.human_id, folder: seedFolder, existing, name: `${date}.md`, content, date });
}

/** Writes one text document into `Syncs/Seed/documents/`. */
export async function writeSeedDocumentFile(projectFolder: VaultFolder, name: string, content: string, date: string): Promise<SeedFileOutcome> {
  const seedFolder = await ensureSeedSyncFolder(projectFolder);
  const docs = await ensureChildFolder(projectFolder.human_id, seedFolder, SEED_DOCUMENTS_FOLDER_NAME);
  const existing = await listingByName(projectFolder.human_id, docs._id);
  return writeSeedFile({ humanId: projectFolder.human_id, folder: docs, existing, name, content, date });
}

/** Files a standalone file (a PDF, a photo) as a seed document on the
 * bytes it already has in storage. The same name with the same hash is
 * the same document. Returns the file's id. */
export async function addSeedDocumentObject(
  projectFolder: VaultFolder,
  input: { name: string; s3Key: string; s3Url: string | null; contentType: string; size: number; contentHash: string; date: string },
): Promise<string> {
  const seedFolder = await ensureSeedSyncFolder(projectFolder);
  const docs = await ensureChildFolder(projectFolder.human_id, seedFolder, SEED_DOCUMENTS_FOLDER_NAME);
  const { files } = await listFolderChildren(projectFolder.human_id, docs._id);
  const same = files.find((f) => f.name === input.name && f.content_hash === input.contentHash);
  if (same) return same._id;
  const created = await createFileRef({
    human_id: projectFolder.human_id,
    name: files.some((f) => f.name === input.name) ? `${input.date} ${input.name}` : input.name,
    s3_key: input.s3Key,
    s3_url: input.s3Url,
    content_type: input.contentType,
    content_hash: input.contentHash,
    size: input.size,
    folder_id: docs._id,
    date: input.date,
  });
  if (!created) throw new Error(`Failed to file ${input.name}`);
  return created._id;
}

/** Every name the seed already speaks under: the day files' headings
 * and the people file. A speaker on this list is known to the project
 * even with no account. */
export async function seedSpeakerNames(projectFolder: VaultFolder): Promise<string[]> {
  const names = new Set<string>();
  for (const day of await listSeedDays(projectFolder)) for (const s of parseSeedDay(day.content).sections) names.add(s.speaker);
  const seed = await findSeedSyncFolder(projectFolder);
  if (seed) {
    const { files } = await listFolderChildren(projectFolder.human_id, seed._id);
    const people = files.find((f) => f.name === SEED_PEOPLE_FILE_NAME);
    const file = people ? await getFileRefById(people._id) : undefined;
    for (const name of parseSeedPeople(file?.content ?? "").keys()) names.add(name);
  }
  return [...names];
}

// ─── Reading it back ────────────────────────────────────────────────────

export type SeedDayListing = { fileId: string; date: string; content: string };

/** The seed days, oldest first, for the Logbook. */
export async function listSeedDays(projectFolder: VaultFolder): Promise<SeedDayListing[]> {
  const seed = await findSeedSyncFolder(projectFolder);
  if (!seed) return [];
  // One query for the folder, not one per day.
  return (await getFileRefsByFolderIds([seed._id]))
    .filter((f) => isSeedDayFileName(f.name) && !!f.date && !!f.content?.trim())
    .map((f) => ({ fileId: f._id, date: f.date!, content: f.content! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── The wipe ───────────────────────────────────────────────────────────

/** A graph day file's front matter without its `sourceHash`, so the next
 * run re-extracts that day from whatever sources remain. Pure. */
export function withoutSourceHash(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  if (!frontmatter) return content;
  let data: Record<string, unknown> | null;
  try {
    data = parseYaml(frontmatter) as Record<string, unknown> | null;
  } catch {
    return content;
  }
  if (!data || typeof data !== "object" || !("sourceHash" in data)) return content;
  const { sourceHash: _dropped, ...rest } = data;
  return `---\n${stringifyYaml(rest).trimEnd()}\n---\n${body}`;
}

/** `graph-structure.md` without the membership lines of the given dates
 * (and without a thread that held nothing else), so the next run finds
 * nothing missing and places the re-extracted days fresh. Without this,
 * the ids of a wiped day stayed listed and the next run reported them as
 * vanished, which put an "incomplete" banner on a page that was exactly
 * as it should be. Pure; returns the content unchanged when no line
 * names one of the dates. */
export function withoutDatesInStructure(content: string, dates: ReadonlySet<string>): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const sections = splitReadmeSections(body);
  const keep = new Map<string, GraphLogNode>();
  let named = false;
  for (const section of sections) {
    for (const id of nodeIdsInSection(section)) {
      if (dates.has(id.split("#")[0])) named = true;
      else keep.set(id, { id } as GraphLogNode);
    }
  }
  if (!named) return content;
  const { sections: pruned } = pruneStaleMembership(sections, keep);
  const next = joinReadmeSections(pruned);
  return frontmatter === null ? next : `---\n${frontmatter}\n---\n${next}`;
}

/** Which graph days a wipe deletes and which it marks to re-extract. A
 * date only seed fed goes; a date live entries also fed stays and is
 * rebuilt from them. Pure. */
export function wipeDecisions(seedDates: Iterable<string>, liveDates: ReadonlySet<string>): { remove: string[]; reextract: string[] } {
  const remove: string[] = [];
  const reextract: string[] = [];
  for (const date of new Set(seedDates)) (liveDates.has(date) ? reextract : remove).push(date);
  return { remove: remove.sort(), reextract: reextract.sort() };
}

export type SeedWipeReport = {
  /** Seed files removed (days, documents, the people file, sidecars). */
  removedFiles: number;
  /** Graph day files deleted: dates only the seed fed. */
  removedDays: string[];
  /** Dates with live entries too, marked to re-extract on the next run. */
  reextractDays: string[];
  /** Whether there was a Seed folder at all. */
  hadSeed: boolean;
};

async function collectDates(humanId: string, folderId: string, skipFolderId: string | null, into: Set<string>, count?: { files: number }): Promise<void> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  for (const f of files) {
    if (count) count.files += 1;
    if (f.date) into.add(f.date);
  }
  for (const sub of folders) {
    if (sub._id === skipFolderId || sub.name === KNOWLEDGE_FOLDER_NAME) continue;
    await collectDates(humanId, sub._id, skipFolderId, into, count);
  }
}

export async function wipeSeed(projectFolder: VaultFolder): Promise<SeedWipeReport> {
  const humanId = projectFolder.human_id;
  const seed = await findSeedSyncFolder(projectFolder);
  if (!seed) return { removedFiles: 0, removedDays: [], reextractDays: [], hadSeed: false };

  const seedDates = new Set<string>();
  const seedCount = { files: 0 };
  await collectDates(humanId, seed._id, null, seedDates, seedCount);
  const liveDates = new Set<string>();
  await collectDates(humanId, seed.parent_folder_id!, seed._id, liveDates);

  // The graph first, the folder last: if a graph step fails the Seed
  // folder is still there and the wipe can run again. The other order
  // left seed-only days in Graph/ with nothing to remove them, since
  // sync-graph never revisits a date with no source.
  const { remove, reextract } = wipeDecisions(seedDates, liveDates);
  const removedDays: string[] = [];
  const reextractDays: string[] = [];
  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (graphFolder) {
    const { files } = await listFolderChildren(humanId, graphFolder._id);
    const byDate = new Map<string, string>();
    for (const f of files) {
      const m = GRAPH_DAY_RE.exec(f.name);
      if (m) byDate.set(m[1], f._id);
    }
    // The index forgets every seed date, removed or re-extracted alike:
    // a re-extracted day is renumbered from 1 and placed fresh.
    const structureListing = files.find((f) => f.name === GRAPH_STRUCTURE_FILE);
    const structure = structureListing ? await getFileRefById(structureListing._id) : undefined;
    if (structure?.content) {
      const next = withoutDatesInStructure(structure.content, seedDates);
      if (next !== structure.content) await updateFileRef(structure._id, { content: next });
    }
    for (const date of remove) {
      const id = byDate.get(date);
      if (!id) continue;
      await deleteFileRef(id);
      removedDays.push(date);
    }
    for (const date of reextract) {
      const id = byDate.get(date);
      if (!id) continue;
      const file = await getFileRefById(id);
      if (!file?.content) continue;
      const next = withoutSourceHash(file.content);
      if (next !== file.content) await updateFileRef(id, { content: next });
      reextractDays.push(date);
    }
  }

  await deleteVaultFolderCascade(seed._id);
  // What the packets made is gone with the folder, so nothing may still
  // say it was sown or still ask about it: every packet file waits again
  // and Sow rebuilds the seed from the packets.
  await deleteSeedQuestionsForProject(projectFolder._id);
  await clearSownForProject(projectFolder._id);
  return { removedFiles: seedCount.files, removedDays, reextractDays, hadSeed: true };
}
