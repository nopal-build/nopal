/**
 * GraphLog's `sync-graph` stage — the second AGENTIC stage (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph (this file)
 *     -> graph-project-view
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog/PhyLog stage: a project's `skills/GRAPH.md` (seeded
 * with real starter instructions, NOT "skip" — see `graphLogDefaults.server.ts`)
 * decides whether/how this runs at all.
 *
 * Reads every file under a project's `syncs/` tree that carries a `date`
 * field (today, only `daily-log-sync`'s own output does — see that
 * file's own `date: entryDate` stamp), plus each one's sibling
 * `_knowledge/<name>.knowledge.md` if `sync-knowledge` already produced
 * one, and asks an LLM (grounded in `GRAPH.md`'s own instructions) to
 * extract citable NODES — verbatim or near-verbatim statements worth
 * remembering on their own — into `Graph/graph-log-YYYY-MM-DD.md`, one
 * file per day that has anything worth capturing (a day can legitimately
 * produce none at all).
 *
 * Each node gets a plain, predictable `### Node <N>` heading (an
 * incrementing counter per day's file, never an LLM-generated title —
 * see `GRAPH.md`) and a verbose `:ref{...}` citation (`oxmarkdown-core`'s
 * `buildRefDirectiveMarkdown`) — PRE-COMPUTED here, never left for the
 * model to hand-format, so a citation's name/datetime/location can never
 * be hallucinated. Cross-day links point only BACKWARD (older days'
 * headings are handed to the model as ready-to-use markdown links,
 * labeled with their date since "Node 1" alone is ambiguous across many
 * days — see the `${d} ${h.heading}` link text below; a day currently
 * being processed is never told about days after it). A node may ALSO
 * link to another node from the SAME day's file, in either direction —
 * the model handles that itself, entirely within its one completion for
 * that day, since nothing else could supply that list ahead of time.
 *
 * IDEMPOTENT via an aggregate hash of that day's candidates' own
 * `content_hash` PLUS each one's knowledge-sidecar hash (so a
 * `KNOWLEDGE.md` change that only touches the sidecar still invalidates
 * the day, not just a source-file edit) — stored in the graph-log file's
 * own front matter. An unchanged day is a total no-op. A CHANGED day's
 * existing `graph-log-*.md` is DELETED and fully regenerated — never
 * partially patched (see the `graphlog` skill's own doc on why: node
 * extraction is a single holistic judgment over the whole day, not
 * something that composes incrementally the way PhyLog's `update_section`
 * does for a README).
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildRefDirectiveMarkdown } from "oxmarkdown-core";
import { splitFrontmatter } from "./project.types";
import {
  createFileRef,
  deleteFileRef,
  getFileRefById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { getHumansById } from "./humans.server";
import {
  ensureProjectGraphFolder,
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import { parseSyncedCardFileName } from "./dailyLogSync.server";
import { KNOWLEDGE_FOLDER_NAME } from "./syncKnowledge.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import type { LlmProvider } from "./llmProvider";

const GRAPH_LOG_PREFIX = "graph-log-";

function graphLogFileName(date: string): string {
  return `${GRAPH_LOG_PREFIX}${date}.md`;
}

function dateFromGraphLogFileName(name: string): string | null {
  const match = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
  return match ? match[1] : null;
}

/** Best-effort GFM-style heading slug — good enough for a link to work
 * once/if `OxRenderer` ever emits real heading `id`s (not required for
 * `graph-project-view` itself, which parses this file's raw markdown
 * structurally, never relies on browser anchor-scrolling). */
function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type NodeHeading = { heading: string; slug: string };

function extractHeadings(markdown: string): NodeHeading[] {
  const out: NodeHeading[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^###\s+(.+)$/.exec(line.trim());
    if (match) out.push({ heading: match[1].trim(), slug: slugifyHeading(match[1].trim()) });
  }
  return out;
}

function existingSourceHash(content: string | null): string | null {
  if (!content) return null;
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return null;
  try {
    const data = parseYaml(frontmatter) as Record<string, unknown> | null;
    const hash = data?.sourceHash;
    return typeof hash === "string" ? hash : null;
  } catch {
    return null;
  }
}

function buildGraphLogContent(input: { date: string; hash: string; body: string }): string {
  const frontmatter = stringifyYaml({
    date: input.date,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body.trim()}\n`;
}

type GraphCandidate = {
  fileId: string;
  name: string;
  date: string;
  contentHash: string | null;
  folderId: string;
};

/** Walks a project's `syncs/` tree recursively, collecting every file
 * that carries a `date` — skipping `_knowledge/` folders (their own
 * contents are read as a CANDIDATE's sidecar, never a candidate in their
 * own right). A file with no `date` set isn't supported yet (today, only
 * `daily-log-sync`'s own output stamps one) — silently excluded, not an
 * error. */
async function collectDatedCandidates(humanId: string, folderId: string): Promise<GraphCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: GraphCandidate[] = files
    .filter((f) => !!f.date)
    .map((f) => ({ fileId: f._id, name: f.name, date: f.date!, contentHash: f.content_hash ?? null, folderId }));
  for (const sub of folders) {
    if (sub.name === KNOWLEDGE_FOLDER_NAME) continue;
    out.push(...(await collectDatedCandidates(humanId, sub._id)));
  }
  return out;
}

/** Finds a candidate's own sibling knowledge sidecar (`_knowledge/<name>.knowledge.md`
 * next to it), if `sync-knowledge` has already produced one — see that
 * stage's own module doc for the naming convention. */
async function findKnowledgeSidecar(
  humanId: string,
  candidate: GraphCandidate,
): Promise<{ fileId: string; contentHash: string | null } | null> {
  const { folders } = await listFolderChildren(humanId, candidate.folderId);
  const knowledgeFolder = folders.find((f) => f.name === KNOWLEDGE_FOLDER_NAME);
  if (!knowledgeFolder) return null;
  const dot = candidate.name.lastIndexOf(".");
  const base = dot > 0 ? candidate.name.slice(0, dot) : candidate.name;
  const sidecarName = `${base}.knowledge.md`;
  const { files } = await listFolderChildren(humanId, knowledgeFolder._id);
  const listing = files.find((f) => f.name === sidecarName);
  return listing ? { fileId: listing._id, contentHash: listing.content_hash ?? null } : null;
}

function aggregateHash(parts: string[]): string {
  return createHash("sha256").update([...parts].sort().join("|")).digest("hex").slice(0, 16);
}

export type SyncGraphDayResult = {
  date: string;
  /** True when a day's graph-log file was newly written or regenerated
   * this run; false when an already-up-to-date one was found and left
   * untouched. */
  changed: boolean;
  /** True when the model decided this day had nothing worth capturing —
   * no `graph-log-*.md` file exists for it (possibly because a PREVIOUS
   * file for this exact day was just deleted, if its sources changed). */
  empty: boolean;
};

export type SyncGraphResult =
  | {
      ok: true;
      /** True when `skills/GRAPH.md` is missing or says "skip" — a total
       * no-op, no files examined, no model called. */
      skipped: boolean;
      days: SyncGraphDayResult[];
    }
  | { ok: false; error: string };

export interface RunSyncGraphOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
}

const NOTHING_SENTINEL = "NOTHING_TO_CAPTURE";

/**
 * Runs sync-graph for one project. Sweeps every day with a dated
 * candidate under `syncs/`, oldest first, so a later day's cross-links
 * can always point at an already-processed earlier day within the same
 * run.
 */
export async function runSyncGraph(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunSyncGraphOptions = {},
): Promise<SyncGraphResult> {
  const log = opts.log ?? (() => {});

  const skill = await getProjectStageSkill(projectFolder, "GRAPH.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, days: [] };
  }
  if (!isPhylogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) {
    log("sync-graph: no syncs/ folder yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const candidates = await collectDatedCandidates(projectFolder.human_id, syncsFolder._id);
  if (candidates.length === 0) {
    log("sync-graph: no dated files under syncs/ yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const byDate = new Map<string, GraphCandidate[]>();
  for (const c of candidates) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const dates = [...byDate.keys()].sort();

  // Resolve every possible contributor's display name up front, one
  // batched lookup — `parseSyncedCardFileName` returns `null` for
  // anything not shaped like a daily-log-sync copy (a future non-daily-
  // log sync source's own file), which just means no attribution name is
  // available for it below.
  const contributorIds = new Set<string>();
  for (const c of candidates) {
    const parsed = parseSyncedCardFileName(c.name);
    if (parsed) contributorIds.add(parsed.humanId);
  }
  const humans = await getHumansById([...contributorIds]);
  const humanNameById = new Map(humans.map((h) => [h._id, h.name]));

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");

  // Seeded from whatever graph-log history already exists (read-only —
  // never forces the Graph folder into existence just to check), then
  // kept current as this run itself regenerates/writes days below, so a
  // LATER date in the SAME run can link to a day this run just wrote.
  const existingGraphFolder = await findProjectGraphFolder(projectFolder);
  const headingsByDate = new Map<string, NodeHeading[]>();
  if (existingGraphFolder) {
    const { files: existingFiles } = await listFolderChildren(
      projectFolder.human_id,
      existingGraphFolder._id,
    );
    for (const f of existingFiles) {
      const date = dateFromGraphLogFileName(f.name);
      if (!date) continue;
      const full = await getFileRefById(f._id);
      if (full?.content) headingsByDate.set(date, extractHeadings(full.content));
    }
  }

  let textLlm: LlmProvider | undefined = opts.provider;
  let realCallsSoFar = 0;
  const days: SyncGraphDayResult[] = [];

  for (const date of dates) {
    const dayCandidates = byDate.get(date)!;

    const hashParts: string[] = [];
    const candidateBlocks: string[] = [];
    for (const candidate of dayCandidates) {
      const source = await getFileRefById(candidate.fileId);
      if (!source) continue;
      hashParts.push(`${candidate.fileId}:${candidate.contentHash ?? candidate.fileId}`);

      const sidecar = await findKnowledgeSidecar(projectFolder.human_id, candidate);
      let knowledgeContent: string | null = null;
      if (sidecar) {
        hashParts.push(`${sidecar.fileId}:${sidecar.contentHash ?? sidecar.fileId}`);
        const sidecarFile = await getFileRefById(sidecar.fileId);
        knowledgeContent = sidecarFile?.content ?? null;
      }

      const parsed = parseSyncedCardFileName(candidate.name);
      const contributorHumanId = parsed?.humanId;
      const contributorName = contributorHumanId
        ? humanNameById.get(contributorHumanId) ?? "Unknown"
        : "Unknown";
      const citation = buildRefDirectiveMarkdown({
        name: contributorName,
        humanId: contributorHumanId,
        datetime: `${date}T12:00:00Z`,
        location: `/fruits/vault?file=${source._id}`,
        verbose: true,
      });

      candidateBlocks.push(
        [
          `Source: "${source.name}" (by ${contributorName})`,
          `Content:\n${source.content ?? "(no readable text content)"}`,
          knowledgeContent ? `Extracted knowledge about this source:\n${knowledgeContent}` : null,
          `If you quote this source, cite it EXACTLY like this (copy verbatim, do not reformat): ${citation}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    const newHash = aggregateHash(hashParts);
    const existingListing = existingGraphFolder
      ? (await listFolderChildren(projectFolder.human_id, existingGraphFolder._id)).files.find(
          (f) => f.name === graphLogFileName(date),
        )
      : undefined;
    const existing = existingListing ? await getFileRefById(existingListing._id) : undefined;

    if (existing && existingSourceHash(existing.content) === newHash) {
      days.push({ date, changed: false, empty: false });
      continue;
    }

    if (existing) {
      await deleteFileRef(existing._id);
    }

    const priorNodes = [...headingsByDate.entries()]
      .filter(([d]) => d < date)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([d, headings]) =>
        headings.map((h) => `[${d} ${h.heading}](./${graphLogFileName(d)}#${h.slug})`),
      );

    const userMessage = [
      `Today's date being processed: ${date}`,
      candidateBlocks.join("\n\n---\n\n"),
      priorNodes.length > 0
        ? `Earlier days' nodes you may link back to (never invent a link to an earlier day that isn't in this list):\n${priorNodes.join("\n")}`
        : "No earlier days' nodes exist yet to link back to.",
      "You may also link a node to another node you write today, in either direction (e.g. today's \"Node 2\" may link to today's \"Node 1\", or the reverse) \u2014 use that node's own heading/anchor, with today's date alongside it, same as any other link.",
      `If nothing from today is worth capturing as a node, respond with exactly: ${NOTHING_SENTINEL}`,
    ].join("\n\n");

    const callStart = Date.now();
    try {
      textLlm ??= new AnthropicProvider();
      const cacheSystemPrompt = realCallsSoFar > 0;
      realCallsSoFar++;
      const response = await textLlm.complete({
        system: `You are GraphLog's sync-graph step, extracting citable nodes from one day's synced content per a project owner's own instructions. Follow those instructions closely; write only the graph-log file's body itself, no preamble.\n\n${skillContent}`,
        messages: [{ role: "user", content: userMessage }],
        tools: [],
        cacheSystemPrompt,
      });

      if (response.stopReason === "max_tokens") {
        log(`sync-graph: ${date}'s output was cut off by the model's own output limit — skipped, will retry next run.`);
        await recordGraphLogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "sync-graph",
          kind: "graph-extract",
          model: response.model,
          usage: response.usage,
          durationMs: Date.now() - callStart,
          outcome: "error",
          errorKind: "incomplete",
        });
        continue;
      }

      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        model: response.model,
        usage: response.usage,
        durationMs: Date.now() - callStart,
        outcome: "success",
      });

      const body = response.text?.trim() ?? "";
      if (!body || body.toUpperCase().startsWith(NOTHING_SENTINEL)) {
        log(`sync-graph: ${date} — nothing worth capturing.`);
        headingsByDate.delete(date);
        days.push({ date, changed: true, empty: true });
        continue;
      }

      const graphFolder = await ensureProjectGraphFolder(projectFolder);
      const content = buildGraphLogContent({ date, hash: newHash, body });
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: graphLogFileName(date),
        content,
        content_type: "text/markdown",
        folder_id: graphFolder._id,
      });
      if (!created) continue;

      headingsByDate.set(date, extractHeadings(content));
      log(`sync-graph: wrote ${graphLogFileName(date)}.`);
      days.push({ date, changed: true, empty: false });
    } catch (err) {
      log(`sync-graph: ${date} couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        durationMs: Date.now() - callStart,
        outcome: "error",
        errorKind: classifyGraphLogError(err),
      });
    }
  }

  return { ok: true, skipped: false, days };
}
