/**
 * PhyLog's capture stage — the SECOND stage of the pipeline (see the
 * `phylog` skill for the full picture):
 *
 *   pre-capture (`preCapture.server.ts`) -> capture (this file)
 *     -> post-capture (`postCapture.server.ts`)
 *
 * Two parts, run per day, oldest first:
 *
 *   1. DETERMINISTIC FILING (`sorter.server.ts`'s `fileCardAttachments`,
 *      unchanged) — every not-yet-filed `::file{...}` Card attachment
 *      (and its pre-capture summary sibling, if one exists) lands in the
 *      project's root.
 *   2. ORGANIZE + README (an LLM agent loop, driven by the project's own
 *      `skills/CAPTURE.md`) — given the project's CURRENT file tree
 *      (everything outside `skills/`/`syncs/`/`newspapers/`, which this
 *      stage never touches), that day's Card content, any pre-capture
 *      summaries, and the current README, the model may call
 *      `create_folder`/`move_file` any number of times to (re)organize
 *      what's been filed, then `update_readme` at most once to keep the
 *      README a real index of the result. The model is told about
 *      OxMarkdown's `::gallery{folder="..."}` directive (see
 *      `buildSystemPrompt`) so it can group related photos into a titled
 *      photo grid — create a subfolder, move the relevant photos into it,
 *      then reference that subfolder by name — instead of listing every
 *      photo as an individual link. This directive is resolved server-side
 *      by `project.server.ts`'s `resolveProjectManifest` and rendered by
 *      `ProjectView` — wired into both the Vault's own file view
 *      (`fruits_.vault.tsx`) and the Newspaper page, so it actually
 *      displays as photos wherever a human looks at this README, not as
 *      an "unknown directive" marker (see the `vault` skill's Projects
 *      section).
 *
 * TWO MODES:
 *   - Incremental (default): walks every day this project has a Card for,
 *     skipping any already recorded (idempotent against a hash of that
 *     day's Card content, exactly like the single-tool version this
 *     replaced) -- "just the daily logs that haven't been applied yet".
 *   - Full (`full: true`): first calls `resetProjectN01Content` (wiping
 *     everything this stage manages, and this project's own Release Log
 *     history -- see that function's own doc for why the latter is
 *     required), then walks EVERY day from scratch. Always an explicit,
 *     separate operation from `nopal phylog reset` alone -- reset only
 *     wipes; `capture --full` wipes AND rebuilds.
 *
 * ALWAYS APPLIES -- there is no preview/dry-run mode. The Release Log's
 * revert mechanism (`nopal release-log revert`) is the safety net.
 *
 * CROSS-HUMAN BY DESIGN: `runCapture`'s own `actingHumanId` parameter is
 * ONLY the human who triggered this run (used for the top-level "agent
 * not configured" style bookkeeping) -- it does NOT restrict which
 * Cards get processed. `listCardEntriesForProject` (`dailyLog.server.ts`)
 * enumerates every (humanId, date) pair that has a Card for THIS project,
 * across every human who's ever written one, and each entry is processed
 * under ITS OWN humanId (filing, README-writing, usage tracking, that
 * human's own daily release-log.md). This isn't a new trust boundary --
 * a Card was already cross-human safe (any Sharing Role, including
 * Observer, may write one for a project they can see -- see the `vault`
 * skill's Cards section, and `sorter.server.ts`'s `fileCardAttachments`,
 * which already filed a collaborator's attachments into the project
 * without needing write access to their vault). Running capture used to
 * silently only sweep the CALLER's own Cards, which meant a project
 * owner's own `phylog capture` run could never see a collaborator's
 * Card at all, no matter how many times it ran -- fixed so any single
 * owner-tier human running this for a shared project applies EVERYONE's
 * outstanding Cards in one pass, not just their own.
 *
 * Each day's organize/README agent loop is isolated in its own try/catch
 * (`captureOneDay`) — a failure on one day (a rate limit, a transient
 * error) never aborts the rest of a multi-day run, same resilience
 * philosophy `preCapture.server.ts` already applies per-file. Every day
 * records exactly one `phylogMetrics.server.ts` usage event (skipped/
 * success/error) — see that file's own doc for the token/timing tracking
 * design.
 *
 * KNOWN LIMITATION: only `update_readme` produces a Release Log CHANGESET
 * (so only README edits are individually revertible) — `create_folder`/
 * `move_file` actions are reported in the entry's own summary text but not
 * tracked as changesets. Reverting a day's `ai-update` entry today
 * restores the README but does not undo any reorganization that happened
 * alongside it. Not solved, flagged on purpose (same spirit as the
 * `vault` skill's own chained-edit replay caveat).
 */

import { createHash } from "node:crypto";
import {
  getDailyLogCards,
  getDailyLogFolderAndReadmeId,
  listCardEntriesForProject,
  type DailyLogCard,
} from "./dailyLog.server";
import {
  createFileRef,
  createVaultFolder,
  getFileRefById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { splitFrontmatter } from "./project.types";
import {
  createReleaseLogEntry,
  findReleaseLogEntryBySource,
  regenerateDailyReleaseLog,
  regenerateProjectReleaseLog,
} from "./releaseLog.server";
import { fileCardAttachments, summaryFileName, type FiledAttachment } from "./sorter.server";
import {
  DEFAULT_CAPTURE_SKILL,
  getProjectStageSkill,
  resetProjectN01Content,
  type ResetSummary,
} from "./projectN01.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyLlmError, recordPhylogUsage } from "./phylogMetrics.server";
import { getHumansById } from "./humans.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

const MANAGED_FOLDER_TYPES = new Set(["skills", "syncs", "newspapers"]);

// ─── Tools ──────────────────────────────────────────────────────────────

const CREATE_FOLDER_TOOL: ToolDefinition = {
  name: "create_folder",
  description:
    "Create a folder (and any missing parent folders) inside this project, to organize filed content. Path is relative to the project root — e.g. \"Photos/2026-08\". Never targets skills/, syncs/, or newspapers/ (reserved). If you plan to reference this folder from a ::gallery{folder=\"...\"} directive in the README, create it as a SINGLE, direct child of the project root (e.g. \"Hip Installation\", not \"Photos/Hip Installation\") — the gallery directive only resolves direct children by name, never nested paths.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative folder path to create, e.g. \"Photos/2026-08\", or a single name like \"Hip Installation\" if you intend to reference it from a gallery." },
    },
    required: ["path"],
  },
};

const MOVE_FILE_TOOL: ToolDefinition = {
  name: "move_file",
  description:
    "Move a file already filed in this project (by its current name) into a different folder inside the project. Creates the destination folder if it doesn't exist yet. Never targets skills/, syncs/, or newspapers/.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The file's current name, exactly as it appears in the tree you were given." },
      destinationPath: { type: "string", description: "Relative destination folder path, e.g. \"Photos/2026-08\". Use \"\" for the project root." },
    },
    required: ["name", "destinationPath"],
  },
};

const UPDATE_README_TOOL: ToolDefinition = {
  name: "update_readme",
  description:
    "Replace the project's README.md BODY (everything after its front matter, if any) with a new version. Call this only when today's Card content, filed attachments, or reorganization actually warrant a real update — skip it entirely on a day where nothing meaningfully changed. Never invent information that isn't grounded in the Card content, pre-capture summaries, or the README's own prior content. To display a GROUP of related photos as a photo grid instead of a bulleted list of links, use ::gallery{folder=\"<direct child folder name>\" title=\"...\"} — see the system prompt's own explanation of this directive.",
  inputSchema: {
    type: "object",
    properties: {
      newBody: { type: "string", description: "The full replacement README body (markdown, front matter excluded)." },
      reason: { type: "string", description: "One sentence explaining what changed and why, for the Release Log." },
    },
    required: ["newBody", "reason"],
  },
};

function withReadmeBody(originalMarkdown: string, newBody: string): string {
  const { frontmatter } = splitFrontmatter(originalMarkdown);
  if (!frontmatter) return newBody;
  return `---\n${frontmatter}\n---\n${newBody}`;
}

async function runAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  tools: ToolDefinition[],
  executors: Record<string, (input: Record<string, unknown>) => Promise<string>>,
  maxTurns = 6,
): Promise<{ toolCallsMade: ToolCall[]; usage: LlmUsage; durationMs: number; model: string | null }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  const loopStart = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await provider.complete({ system, messages, tools });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
  }
  return { toolCallsMade, usage, durationMs: Date.now() - loopStart, model };
}

/** Renders every folder/file in `projectFolder`'s tree EXCLUDING the
 * skills/syncs/newspapers subtrees — capture never touches, and never
 * even shows the model, the one human-writable part of a project-n01
 * folder. */
async function renderManagedTree(
  humanId: string,
  folderId: string,
  indent = ""
): Promise<string> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const lines: string[] = [];
  for (const folder of folders) {
    if (folder.is_folder_type_root && MANAGED_FOLDER_TYPES.has(folder.folder_type ?? "")) continue;
    lines.push(`${indent}${folder.name}/`);
    lines.push(await renderManagedTree(humanId, folder._id, `${indent}  `));
  }
  for (const file of files) {
    if (file.name.toLowerCase() === "readme.md") continue;
    lines.push(`${indent}${file.name}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** Finds a file by name anywhere in the managed (non skills/syncs/
 * newspapers) part of the project tree. */
async function findManagedFileByName(
  humanId: string,
  folderId: string,
  name: string,
): Promise<{ fileId: string } | null> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const match = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (match) return { fileId: match._id };
  for (const folder of folders) {
    if (folder.is_folder_type_root && MANAGED_FOLDER_TYPES.has(folder.folder_type ?? "")) continue;
    const found = await findManagedFileByName(humanId, folder._id, name);
    if (found) return found;
  }
  return null;
}

/** mkdir -p, relative to the project root — refuses to cross into a
 * skills/syncs/newspapers anchor by name. */
async function resolveOrCreatePath(
  projectFolder: VaultFolder,
  relativePath: string,
): Promise<{ ok: true; folderId: string } | { ok: false; error: string }> {
  const segments = relativePath.split("/").map((s) => s.trim()).filter(Boolean);
  let currentId = projectFolder._id;
  for (const segment of segments) {
    const { folders } = await listFolderChildren(projectFolder.human_id, currentId);
    const existingAnchor = folders.find(
      (f) => f.is_folder_type_root && MANAGED_FOLDER_TYPES.has(f.folder_type ?? "") &&
        f.name.toLowerCase() === segment.toLowerCase(),
    );
    if (existingAnchor) {
      return { ok: false, error: `"${segment}" is a reserved folder (skills/syncs/newspapers) and can't be used here` };
    }
    const existing = folders.find((f) => f.name.toLowerCase() === segment.toLowerCase());
    if (existing) {
      currentId = existing._id;
      continue;
    }
    const created = await createVaultFolder({
      human_id: projectFolder.human_id,
      name: segment,
      parent_folder_id: currentId,
    });
    if (!created) return { ok: false, error: `Failed to create folder "${segment}"` };
    currentId = created._id;
  }
  return { ok: true, folderId: currentId };
}

const DIRECTIVE_GUIDE = `## Available markdown directives

The README is rendered with OxMarkdown directive support, not plain markdown alone — use these where they genuinely help instead of always writing plain bullet lists of links:

- ::gallery{folder="<name>" title="Optional title"} — renders EVERY image inside a folder as a titled photo grid, instead of one link per photo. The folder MUST be a SINGLE, direct child of this project's root (create it with create_folder using a plain name like "Hip Installation", never a nested path like "Photos/Hip Installation" — the directive can't resolve nested paths). Use this whenever you're presenting a GROUP of related photos (e.g. everything from one day, or one phase of work) — create the folder, move the relevant photos into it with move_file, then reference it by name. A single, standout photo can still just be an ordinary markdown link.
- ::csv-table{file="project.csv" title="Optional title"} — renders a CSV file (a direct child of the project root) as a table.
- ::svg{file="<name>" title="Optional title"} — renders an SVG file (a direct child of the project root) inline.

All three only resolve DIRECT children of the project root by name — never nested paths, never files/folders inside skills/syncs/newspapers.`;

function buildSystemPrompt(skillContent: string, generalSkill: string | null): string {
  const generalSection = generalSkill ? `\n\n## Project SKILL.md (general steering)\n\n${generalSkill}` : "";
  return `You are PhyLog, capturing a project's daily work into a well-organized structure and an up-to-date README.

You will be given:
- This project's own CAPTURE.md instructions (and, if present, its general SKILL.md steering) — follow them closely.
- The project's CURRENT file tree (excluding its skills/syncs/newspapers folders, which you can never see or touch).
- One day's Card content for this project, and any files just filed into it today.
- Pre-capture summaries for any of today's attachments, when available.
- The project's current README.md.

You may call create_folder / move_file any number of times to organize today's filed content, then update_readme AT MOST ONCE with the full new body if the README genuinely needs to change. Most days, especially quiet ones, need no README change — do nothing rather than making a cosmetic edit. Never fabricate progress, dates, or facts not grounded in what you were given.

${DIRECTIVE_GUIDE}

## Project CAPTURE.md

${skillContent}${generalSection}`;
}

function buildUserPrompt(input: {
  tree: string;
  cardContent: string;
  filed: FiledAttachment[];
  summaries: { name: string; body: string }[];
  readmeContent: string;
}): string {
  const parts: string[] = [];
  parts.push(`## Current project tree\n\n${input.tree || "(empty)"}`);
  parts.push(`## Today's Card content\n\n${input.cardContent || "(empty)"}`);
  if (input.filed.length > 0) {
    parts.push(`## Filed today\n\n${input.filed.map((f) => `- ${f.name}`).join("\n")}`);
  }
  if (input.summaries.length > 0) {
    parts.push(
      `## Pre-capture summaries\n\n${input.summaries.map((s) => `### ${s.name}\n\n${s.body}`).join("\n\n")}`,
    );
  }
  parts.push(`## Current README.md\n\n${input.readmeContent || "(empty)"}`);
  return parts.join("\n\n---\n\n");
}

export type CaptureDayResult = {
  date: string;
  /** Whose own Card this day's processing came from -- capture now walks
   * EVERY collaborator's Cards for this project, not just whoever
   * invoked the run (see `listCardEntriesForProject`), so a single
   * `runCapture` call can produce several `CaptureDayResult`s for the
   * SAME date, one per human. */
  humanId: string;
  filed: FiledAttachment[];
  organizeActions: string[];
  readmeUpdated: boolean;
  alreadyApplied: boolean;
};

export type CaptureResult =
  | { ok: true; full: boolean; resetSummary?: ResetSummary; days: CaptureDayResult[] }
  | { ok: false; error: string };

export async function runCapture(
  actingHumanId: string,
  projectFolder: VaultFolder,
  opts: { full: boolean; since?: string; until?: string; provider?: LlmProvider },
  onProgress?: (line: string) => void,
): Promise<CaptureResult> {
  const log = onProgress ?? (() => {});
  if (!opts.provider && !isPhylogAgentConfigured()) {
    return { ok: false, error: "PhyLog's agent is not configured (no ANTHROPIC_API_KEY set)." };
  }

  let resetSummary: ResetSummary | undefined;
  if (opts.full) {
    log("capture: --full — resetting project-managed content before rebuilding…");
    resetSummary = await resetProjectN01Content(projectFolder);
    log(
      `capture: reset removed ${resetSummary.deletedFolders.length} folder(s) and ${resetSummary.deletedFiles.length} file(s).`,
    );
  }

  const until = opts.until ?? new Date().toISOString().slice(0, 10);
  const entries = await listCardEntriesForProject(projectFolder._id, {
    since: opts.since,
    until,
  });
  if (entries.length === 0) {
    log("capture: no Card found for this project on any day in range.");
    return { ok: true, full: opts.full, resetSummary, days: [] };
  }

  // Human-readable labels for the progress log only (never affects which
  // entries get processed) -- one batched lookup instead of one per entry.
  const humans = await getHumansById([...new Set(entries.map((e) => e.humanId))]);
  const humanLabelById = new Map(humans.map((h) => [h._id, h.name || h.email]));
  const describeHuman = (id: string) => humanLabelById.get(id) ?? id;

  const skillContent = (await getProjectStageSkill(projectFolder, "CAPTURE.md")) ?? DEFAULT_CAPTURE_SKILL;
  // Backward-compat continuity: a project may already have a general
  // skills/SKILL.md predating this pipeline (the old README-writer's own
  // steering file) — fold it in too, alongside CAPTURE.md's own
  // instructions, rather than silently dropping it.
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const llm = opts.provider ?? new AnthropicProvider();
  const days: CaptureDayResult[] = [];
  // Keyed `${humanId}:${date}` -> humanId (same convention
  // `releaseLog.server.ts`'s `clearReleaseLogForProject` already uses) --
  // a single date can now be touched by SEVERAL different humans' own
  // Cards, and each one's own release-log.md lives in THEIR OWN vault, so
  // regenerating "the day's release log" has to happen per (human, date),
  // never just per date.
  const touchedHumanDates = new Map<string, string>();
  let releaseLogsDirty = false;

  for (const { humanId: cardHumanId, date } of entries) {
    const cards = await getDailyLogCards(cardHumanId, date);
    const card = cards.find((c) => c.projectFolderId === projectFolder._id);
    if (!card) continue;

    const who = describeHuman(cardHumanId);
    log(`capture: ${date} (${who}) -- filing attachments...`);
    const { filed } = await fileCardAttachments(card, date, cardHumanId, { dryRun: false });
    if (filed.length > 0) {
      releaseLogsDirty = true;
      touchedHumanDates.set(`${cardHumanId}:${date}`, cardHumanId);
      for (const f of filed) log(`capture: ${date} (${who}) -- filed "${f.name}".`);
    }

    const contentHash = createHash("sha256").update(card.content).digest("hex").slice(0, 16);
    const sourceRef = `${card.fileId}:${contentHash}`;
    const existing = await findReleaseLogEntryBySource(projectFolder._id, date, "ai-update", sourceRef);
    if (existing) {
      log(`capture: ${date} (${who}) -- already applied for this Card's current content.`);
      await recordPhylogUsage({
        humanId: cardHumanId,
        projectFolderId: projectFolder._id,
        stage: "capture",
        kind: "organize",
        durationMs: 0,
        outcome: "skipped",
      });
      days.push({ date, humanId: cardHumanId, filed, organizeActions: [], readmeUpdated: false, alreadyApplied: true });
      continue;
    }

    let readmeUpdated = false;
    let organizeActions: string[] = [];
    try {
      const result = await captureOneDay({
        actingHumanId: cardHumanId,
        projectFolder,
        date,
        card,
        filed,
        sourceRef,
        llm,
        skillContent,
        generalSkill,
        log,
      });
      readmeUpdated = result.readmeUpdated;
      organizeActions = result.organizeActions;
      if (readmeUpdated || organizeActions.length > 0) {
        releaseLogsDirty = true;
        touchedHumanDates.set(`${cardHumanId}:${date}`, cardHumanId);
      } else {
        log(`capture: ${date} (${who}) -- no README update or reorganization warranted.`);
      }
    } catch (err) {
      log(
        `capture: ${date} (${who}) -- organize/README step failed (${err instanceof Error ? err.message : "unknown error"}).`,
      );
      await recordPhylogUsage({
        humanId: cardHumanId,
        projectFolderId: projectFolder._id,
        stage: "capture",
        kind: "organize",
        durationMs: 0,
        outcome: "error",
        errorKind: classifyLlmError(err),
      });
    }

    days.push({ date, humanId: cardHumanId, filed, organizeActions, readmeUpdated, alreadyApplied: false });
  }

  if (releaseLogsDirty) {
    await regenerateProjectReleaseLog(projectFolder._id);
    for (const [key, humanId] of touchedHumanDates) {
      const date = key.slice(humanId.length + 1);
      const { dateFolderId } = await getDailyLogFolderAndReadmeId(humanId, date);
      await regenerateDailyReleaseLog(humanId, date, dateFolderId);
    }
  }

  return { ok: true, full: opts.full, resetSummary, days };
}

/**
 * Runs the organize/README agent loop for ONE day — split out so
 * `runCapture`'s own per-day try/catch can isolate a failure to just that
 * day (see this file's own module doc). Records exactly one
 * `phylogMetrics` usage event for the day's agent loop on success; the
 * caller records "skipped" (already applied) and "error" cases itself,
 * since those never reach this function at all or throw out of it.
 */
async function captureOneDay(input: {
  actingHumanId: string;
  projectFolder: VaultFolder;
  date: string;
  card: DailyLogCard;
  filed: FiledAttachment[];
  sourceRef: string;
  llm: LlmProvider;
  skillContent: string;
  generalSkill: string | null;
  log: (line: string) => void;
}): Promise<{ readmeUpdated: boolean; organizeActions: string[] }> {
  const { actingHumanId, projectFolder, date, card, filed, sourceRef, llm, skillContent, generalSkill, log } = input;

  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  const readmeContent = readme?.content ?? "";
  const tree = await renderManagedTree(projectFolder.human_id, projectFolder._id);

  const summaries: { name: string; body: string }[] = [];
  for (const f of filed) {
    const { files: siblings } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
    const listing = siblings.find((s) => s.name === summaryFileName(f.name));
    if (!listing) continue;
    const file = await getFileRefById(listing._id);
    if (file?.content) summaries.push({ name: f.name, body: splitFrontmatter(file.content).body.trim() });
  }

  const organizeActions: string[] = [];
  const executors: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    create_folder: async (input) => {
      const path = String(input.path ?? "");
      const result = await resolveOrCreatePath(projectFolder, path);
      if (!result.ok) return `Error: ${result.error}`;
      organizeActions.push(`created folder "${path}"`);
      log(`capture: ${date} — created folder "${path}".`);
      return `Created (or already existed): ${path || "/"}`;
    },
    move_file: async (input) => {
      const name = String(input.name ?? "");
      const destinationPath = String(input.destinationPath ?? "");
      const found = await findManagedFileByName(projectFolder.human_id, projectFolder._id, name);
      if (!found) return `Error: no file named "${name}" found in this project`;
      const dest = await resolveOrCreatePath(projectFolder, destinationPath);
      if (!dest.ok) return `Error: ${dest.error}`;
      await updateFileRef(found.fileId, { folder_id: dest.folderId });
      organizeActions.push(`moved "${name}" to "${destinationPath || "/"}"`);
      log(`capture: ${date} — moved "${name}" to "${destinationPath || "/"}".`);
      return `Moved "${name}" to ${destinationPath || "/"}`;
    },
    update_readme: async () => "Recorded.",
  };

  const userPrompt = buildUserPrompt({ tree, cardContent: card.content, filed, summaries, readmeContent });
  const { toolCallsMade, usage, durationMs, model } = await runAgentLoop(
    llm,
    buildSystemPrompt(skillContent, generalSkill),
    userPrompt,
    [CREATE_FOLDER_TOOL, MOVE_FILE_TOOL, UPDATE_README_TOOL],
    executors,
  );

  await recordPhylogUsage({
    humanId: actingHumanId,
    projectFolderId: projectFolder._id,
    stage: "capture",
    kind: "organize",
    model: model ?? undefined,
    usage,
    durationMs,
    outcome: "success",
  });

  const updateCall = toolCallsMade.find((c) => c.name === "update_readme");
  let readmeUpdated = false;
  if (updateCall) {
    const newBody = String(updateCall.input.newBody ?? "");
    const reason = String(updateCall.input.reason ?? "");
    const oldFullContent = readmeContent;
    const newFullContent = withReadmeBody(oldFullContent, newBody);

    let readmeFileId = readme?._id;
    if (!readme) {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: "README.md",
        content: newFullContent,
        content_type: "text/markdown",
        folder_id: projectFolder._id,
      });
      readmeFileId = created?._id;
    } else {
      await updateFileRef(readme._id, { content: newFullContent });
    }

    if (readmeFileId) {
      const actionSummary = organizeActions.length > 0 ? ` (also: ${organizeActions.join(", ")})` : "";
      await createReleaseLogEntry({
        projectFolderId: projectFolder._id,
        date,
        actingHumanId,
        kind: "ai-update",
        summary: `PhyLog captured the day — [View](/fruits/vault?file=${readmeFileId}): ${reason}${actionSummary}`,
        sourceRef,
        changesets: [
          { fileId: readmeFileId, action: "content-edit", before: { content: oldFullContent }, after: { content: newFullContent } },
        ],
      });
      readmeUpdated = true;
      log(`capture: ${date} — README updated: ${reason}`);
    }
  } else if (organizeActions.length > 0) {
    // Reorganization happened without a README change — still worth a
    // (changeset-less) Release Log entry so it's visible in the project's
    // own receipt, using the same sourceRef so a re-run doesn't repeat it.
    await createReleaseLogEntry({
      projectFolderId: projectFolder._id,
      date,
      actingHumanId,
      kind: "ai-update",
      summary: `PhyLog reorganized this project: ${organizeActions.join(", ")}`,
      sourceRef,
    });
  }

  return { readmeUpdated, organizeActions };
}
