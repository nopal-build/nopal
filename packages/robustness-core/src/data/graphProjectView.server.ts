/**
 * GraphLog's `graph-project-view` stage — the final, AGENTIC stage (see
 * the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view (this file)
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog/PhyLog stage: a project's `skills/PROJECT_VIEW.md`
 * (seeded with real starter instructions, NOT "skip" — see
 * `graphLogDefaults.server.ts`) decides whether/how this runs at all.
 *
 * Reads `Graph/graph-log-YYYY-MM-DD.md` files (`sync-graph`'s own output),
 * OLDEST-NOT-YET-APPLIED first, and uses each one to keep `README.md` an
 * accurate, organized synthesis — never inventing progress, dates, or
 * facts that aren't grounded in that day's own graph-log content. A
 * bounded tool-calling loop (`update_section`/`remove_section`, mirroring
 * PhyLog's own `capture.server.ts` shape closely but simplified: no
 * chunking protocol, no `write_file`/`update_readme`/reorganize yet — see
 * this file's own "Deliberately deferred" note) lets the model touch only
 * the sections a given day actually has something new to say about,
 * rather than rewriting the whole README every time.
 *
 * IDEMPOTENT per graph-log file via an `appliedSourceHash` field this
 * stage stamps onto that file's OWN front matter once its update
 * completes cleanly (alongside `sync-graph`'s own `date`/`sourceHash`
 * fields — never overwriting them). A day whose `sourceHash` no longer
 * matches its `appliedSourceHash` (because `sync-graph` regenerated it
 * with new content) is reprocessed; one that matches is skipped entirely.
 * INCREMENTAL BY CONSTRUCTION: resetting a project's README and
 * re-running this from scratch just means every graph-log file's
 * `appliedSourceHash` no longer matches (or is absent) — no separate
 * "full" mode needed, unlike PhyLog's own `capture --full`.
 *
 * Deliberately deferred (start simple; add if a real need shows up, same
 * philosophy the `oxmarkdown` skill's Grid/Gallery/Toggle List promotions
 * already established):
 *   - `write_file` (splitting detail into a separate reference file) and
 *     `update_readme` (a full-body rewrite) — `update_section`/
 *     `remove_section` alone are enough to prove out the incremental
 *     shape first.
 *   - A dedicated "reorganize" pass (PhyLog's `runReorganize` equivalent).
 *   - Truncation-retry escalation (`capture.server.ts`'s own
 *     `MAX_TRUNCATION_RETRIES` dance) — a turn that hits `max_tokens` here
 *     is simply treated as an error for that day and retried on a future
 *     run, same "leave it, retry later" convention `sync-knowledge`/
 *     `sync-graph` already use.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createFileRef,
  getFileRefById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import {
  joinReadmeSections,
  splitFrontmatter,
  splitReadmeSections,
  withReadmeBody,
} from "./project.types";
import {
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

function dateFromGraphLogFileName(name: string): string | null {
  const match = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
  return match ? match[1] : null;
}

type GraphLogFrontmatter = {
  date?: string;
  sourceHash?: string;
  appliedSourceHash?: string;
  generatedAt?: string;
};

function parseGraphLogFrontmatter(content: string | null): GraphLogFrontmatter {
  if (!content) return {};
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return {};
  try {
    return (parseYaml(frontmatter) as GraphLogFrontmatter) ?? {};
  } catch {
    return {};
  }
}

/** Stamps `appliedSourceHash` onto a graph-log file's OWN front matter,
 * alongside (never replacing) `sync-graph`'s own `date`/`sourceHash`/
 * `generatedAt` fields — the idempotency marker this stage's next run
 * checks against. */
async function markGraphLogApplied(fileId: string, content: string, sourceHash: string): Promise<void> {
  const { body } = splitFrontmatter(content);
  const meta = parseGraphLogFrontmatter(content);
  const frontmatter = stringifyYaml({ ...meta, appliedSourceHash: sourceHash }).trimEnd();
  await updateFileRef(fileId, { content: `---\n${frontmatter}\n---\n${body}` });
}

// ─── The README tool-calling loop ──────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "update_section",
    description:
      'Replace or create one "## Heading" section in README.md with the given full content. Use heading: "" for the intro (everything before the first heading).',
    inputSchema: {
      type: "object",
      properties: {
        heading: { type: "string" },
        content: { type: "string" },
      },
      required: ["heading", "content"],
    },
  },
  {
    name: "remove_section",
    description: 'Deletes one "## Heading" section from README.md entirely.',
    inputSchema: {
      type: "object",
      properties: { heading: { type: "string" } },
      required: ["heading"],
    },
  },
];

function createReadmeExecutors(input: {
  projectFolder: VaultFolder;
  log: (line: string) => void;
  initialContent: string;
  initialFileId: string | undefined;
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  summaries: string[];
  hadRefusal: () => boolean;
  getCurrent: () => { content: string; fileId: string | undefined };
} {
  const { projectFolder, log } = input;
  let currentContent = input.initialContent;
  let currentFileId = input.initialFileId;
  let hadRefusal = false;
  const summaries: string[] = [];

  async function commit(newFullContent: string): Promise<boolean> {
    if (!currentFileId) {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: "README.md",
        content: newFullContent,
        content_type: "text/markdown",
        folder_id: projectFolder._id,
      });
      if (!created) return false;
      currentFileId = created._id;
    } else {
      await updateFileRef(currentFileId, { content: newFullContent });
    }
    currentContent = newFullContent;
    return true;
  }

  const executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>> = {
    update_section: async (toolInput) => {
      const heading = String(toolInput.heading ?? "").trim();
      const content = String(toolInput.content ?? "");
      const key = heading.toLowerCase();
      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      const existing = existingIndex === -1 ? null : sections[existingIndex];

      if (content.trim().length === 0 && existing && existing.content.trim().length > 0) {
        hadRefusal = true;
        const label = heading || "(intro)";
        log(`graph-project-view -- refused update_section "${label}" (would erase real content with an empty section); left unchanged.`);
        return `Error: refused -- section "${label}" currently has real content; sending empty content would erase it. Use remove_section if you genuinely want to delete it.`;
      }

      const updatedSections = existing
        ? sections.map((s, i) => (i === existingIndex ? { heading: existing.heading, content } : s))
        : [...sections, { heading, content }];
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(updatedSections)));
      if (!ok) return "Error: failed to save section update";
      const label = heading || "(intro)";
      summaries.push(existing ? `updated "${label}"` : `added "${label}"`);
      log(`graph-project-view -- ${existing ? "updated" : "added"} README section "${label}".`);
      return `${existing ? "Updated" : "Added"} section "${label}".`;
    },
    remove_section: async (toolInput) => {
      const heading = String(toolInput.heading ?? "").trim();
      const key = heading.toLowerCase();
      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      if (existingIndex === -1) return `Error: no section named "${heading}" found`;
      const updatedSections = sections.filter((_, i) => i !== existingIndex);
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(updatedSections)));
      if (!ok) return "Error: failed to remove section";
      summaries.push(`removed "${heading}"`);
      log(`graph-project-view -- removed README section "${heading}".`);
      return `Removed section "${heading}".`;
    },
  };

  return { executors, summaries, hadRefusal: () => hadRefusal, getCurrent: () => ({ content: currentContent, fileId: currentFileId }) };
}

const MAX_TURNS = 8;

async function runReadmeAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  cacheSystemPrompt: boolean,
): Promise<{
  usage: LlmUsage;
  model: string | null;
  truncated: boolean;
  hitMaxTurns: boolean;
  toolCallsMade: ToolCall[];
}> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await provider.complete({ system, messages, tools: TOOLS, cacheSystemPrompt });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    if (response.stopReason === "max_tokens") {
      // See this file's own "Deliberately deferred" note — no retry
      // escalation yet, just stop; whatever earlier turns already
      // committed stands, and this day is retried on a future run.
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns, toolCallsMade };
}

// ─── Main entry point ───────────────────────────────────────────────────

export type GraphProjectViewDayResult = {
  date: string;
  /** True when the model made at least one README edit for this day. */
  changed: boolean;
};

export type GraphProjectViewResult =
  | {
      ok: true;
      /** True when `skills/PROJECT_VIEW.md` is missing or says "skip" —
       * a total no-op, no files examined, no model called. */
      skipped: boolean;
      days: GraphProjectViewDayResult[];
    }
  | { ok: false; error: string };

export interface RunGraphProjectViewOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
}

function buildSystemPrompt(skillContent: string): string {
  return `You are GraphLog's graph-project-view step, keeping a project's README.md an accurate, organized synthesis of one day's worth of graph-log nodes at a time. Never invent progress, dates, or facts that aren't grounded in the graph-log content given to you or the README's own existing content. Only touch sections that this specific day's content actually gives you something new to say about — call update_section/remove_section as needed, then stop (no more tool calls) once you're done with this day. If this day's content doesn't change anything about the README, simply make no tool calls at all.\n\n${skillContent}`;
}

function buildUserPrompt(input: { date: string; graphLogBody: string; readmeContent: string }): string {
  const currentBody = splitFrontmatter(input.readmeContent).body.trim();
  return [
    `Today's graph-log date: ${input.date}`,
    `Graph-log content for this day:\n\n${input.graphLogBody}`,
    currentBody
      ? `README.md's CURRENT body (edit this incrementally via update_section/remove_section):\n\n${currentBody}`
      : "README.md is currently empty — this is the first content it will ever have.",
  ].join("\n\n---\n\n");
}

/**
 * Runs graph-project-view for one project: walks every
 * `Graph/graph-log-*.md` file whose `sourceHash` doesn't yet match a
 * stored `appliedSourceHash`, oldest first, feeding each one's content to
 * a bounded README-editing tool loop.
 */
export async function runGraphProjectView(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunGraphProjectViewOptions = {},
): Promise<GraphProjectViewResult> {
  const log = opts.log ?? (() => {});

  const skill = await getProjectStageSkill(projectFolder, "PROJECT_VIEW.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, days: [] };
  }
  if (!isPhylogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) {
    log("graph-project-view: no Graph/ folder yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const { files: graphFiles } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const dated = graphFiles
    .map((f) => ({ listing: f, date: dateFromGraphLogFileName(f.name) }))
    .filter((f): f is { listing: typeof graphFiles[number]; date: string } => !!f.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (dated.length === 0) {
    log("graph-project-view: no graph-log files yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");
  const system = buildSystemPrompt(skillContent);

  let textLlm: LlmProvider | undefined = opts.provider;
  let realCallsSoFar = 0;
  const days: GraphProjectViewDayResult[] = [];

  for (const { listing, date } of dated) {
    const graphLogFile = await getFileRefById(listing._id);
    if (!graphLogFile?.content) continue;
    const meta = parseGraphLogFrontmatter(graphLogFile.content);
    if (!meta.sourceHash) continue; // malformed/foreign file — skip, don't guess.
    if (meta.appliedSourceHash === meta.sourceHash) {
      days.push({ date, changed: false });
      continue;
    }

    const readmeFile = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
    const { executors, summaries, hadRefusal } = createReadmeExecutors({
      projectFolder,
      log,
      initialContent: readmeFile?.content ?? "",
      initialFileId: readmeFile?._id,
    });

    const userPrompt = buildUserPrompt({
      date,
      graphLogBody: splitFrontmatter(graphLogFile.content).body.trim(),
      readmeContent: readmeFile?.content ?? "",
    });

    const callStart = Date.now();
    try {
      textLlm ??= new AnthropicProvider();
      const cacheSystemPrompt = realCallsSoFar > 0;
      realCallsSoFar++;
      const { usage, model, truncated, hitMaxTurns } = await runReadmeAgentLoop(
        textLlm,
        system,
        userPrompt,
        executors,
        cacheSystemPrompt,
      );

      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "graph-project-view",
        kind: "project-view",
        model: model ?? undefined,
        usage,
        durationMs: Date.now() - callStart,
        outcome: truncated ? "error" : "success",
        errorKind: truncated ? "incomplete" : undefined,
      });

      if (truncated) {
        log(`graph-project-view: ${date}'s update was cut off by the model's own output limit — skipped, will retry next run.`);
        continue;
      }
      if (hitMaxTurns) {
        log(`graph-project-view: ${date} hit its turn limit before finishing — will retry next run.`);
        continue;
      }
      if (hadRefusal()) {
        log(`graph-project-view: ${date} had at least one refused edit — will retry next run.`);
        continue;
      }

      // Clean finish (whether or not any edit actually happened) — mark
      // this day applied so it's never reprocessed unless sync-graph
      // regenerates it with new content.
      await markGraphLogApplied(listing._id, graphLogFile.content, meta.sourceHash);
      const changed = summaries.length > 0;
      if (changed) {
        log(`graph-project-view: ${date} — ${summaries.join(", ")}.`);
      } else {
        log(`graph-project-view: ${date} — nothing to change.`);
      }
      days.push({ date, changed });
    } catch (err) {
      log(`graph-project-view: ${date} couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "graph-project-view",
        kind: "project-view",
        durationMs: Date.now() - callStart,
        outcome: "error",
        errorKind: classifyGraphLogError(err),
      });
    }
  }

  return { ok: true, skipped: false, days };
}
