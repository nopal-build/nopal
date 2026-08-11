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
 *      README a real index of the result.
 *
 * TWO MODES:
 *   - Incremental (default): walks every day this project has a Card for,
 *     skipping any already recorded (idempotent against a hash of that
 *     day's Card content, exactly like the single-tool version this
 *     replaced) — "just the daily logs that haven't been applied yet".
 *   - Full (`full: true`): first calls `resetProjectN01Content` (wiping
 *     everything this stage manages, and this project's own Release Log
 *     history — see that function's own doc for why the latter is
 *     required), then walks EVERY day from scratch. Always an explicit,
 *     separate operation from `nopal phylog reset` alone — reset only
 *     wipes; `capture --full` wipes AND rebuilds.
 *
 * ALWAYS APPLIES — there is no preview/dry-run mode. The Release Log's
 * revert mechanism (`nopal release-log revert`) is the safety net.
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
  listCardDatesForProject,
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
import type { LlmMessage, LlmProvider, ToolCall, ToolDefinition } from "./llmProvider";

const MANAGED_FOLDER_TYPES = new Set(["skills", "syncs", "newspapers"]);

// ─── Tools ──────────────────────────────────────────────────────────────

const CREATE_FOLDER_TOOL: ToolDefinition = {
  name: "create_folder",
  description:
    "Create a folder (and any missing parent folders) inside this project, to organize filed content. Path is relative to the project root — e.g. \"Photos/2026-08\". Never targets skills/, syncs/, or newspapers/ (reserved).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative folder path to create, e.g. \"Photos/2026-08\"." },
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
    "Replace the project's README.md BODY (everything after its front matter, if any) with a new version. Call this only when today's Card content, filed attachments, or reorganization actually warrant a real update — skip it entirely on a day where nothing meaningfully changed. Never invent information that isn't grounded in the Card content, pre-capture summaries, or the README's own prior content.",
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
): Promise<{ toolCallsMade: ToolCall[] }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await provider.complete({ system, messages, tools });
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
  return { toolCallsMade };
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
  const dates = await listCardDatesForProject(actingHumanId, projectFolder._id, {
    since: opts.since,
    until,
  });
  if (dates.length === 0) {
    log("capture: no Card found for this project on any day in range.");
    return { ok: true, full: opts.full, resetSummary, days: [] };
  }

  const skillContent = (await getProjectStageSkill(projectFolder, "CAPTURE.md")) ?? DEFAULT_CAPTURE_SKILL;
  // Backward-compat continuity: a project may already have a general
  // skills/SKILL.md predating this pipeline (the old README-writer's own
  // steering file) — fold it in too, alongside CAPTURE.md's own
  // instructions, rather than silently dropping it.
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const llm = opts.provider ?? new AnthropicProvider();
  const days: CaptureDayResult[] = [];
  const touchedDates = new Set<string>();
  let releaseLogsDirty = false;

  for (const date of dates) {
    const cards = await getDailyLogCards(actingHumanId, date);
    const card = cards.find((c) => c.projectFolderId === projectFolder._id);
    if (!card) continue;

    log(`capture: ${date} — filing attachments…`);
    const { filed } = await fileCardAttachments(card, date, actingHumanId, { dryRun: false });
    if (filed.length > 0) {
      releaseLogsDirty = true;
      touchedDates.add(date);
      for (const f of filed) log(`capture: ${date} — filed "${f.name}".`);
    }

    const contentHash = createHash("sha256").update(card.content).digest("hex").slice(0, 16);
    const sourceRef = `${card.fileId}:${contentHash}`;
    const existing = await findReleaseLogEntryBySource(projectFolder._id, date, "ai-update", sourceRef);
    if (existing) {
      log(`capture: ${date} — already applied for this Card's current content.`);
      days.push({ date, filed, organizeActions: [], readmeUpdated: false, alreadyApplied: true });
      continue;
    }

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
    const { toolCallsMade } = await runAgentLoop(
      llm,
      buildSystemPrompt(skillContent, generalSkill),
      userPrompt,
      [CREATE_FOLDER_TOOL, MOVE_FILE_TOOL, UPDATE_README_TOOL],
      executors,
    );

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
        releaseLogsDirty = true;
        touchedDates.add(date);
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
      releaseLogsDirty = true;
      touchedDates.add(date);
    } else {
      log(`capture: ${date} — no README update or reorganization warranted.`);
    }

    days.push({ date, filed, organizeActions, readmeUpdated, alreadyApplied: false });
  }

  if (releaseLogsDirty) {
    await regenerateProjectReleaseLog(projectFolder._id);
    for (const date of touchedDates) {
      const { dateFolderId } = await getDailyLogFolderAndReadmeId(actingHumanId, date);
      await regenerateDailyReleaseLog(actingHumanId, date, dateFolderId);
    }
  }

  return { ok: true, full: opts.full, resetSummary, days };
}
