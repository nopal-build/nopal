/**
 * PhyLog's capture stage — the SECOND stage of the pipeline (see the
 * `phylog` skill for the full picture):
 *
 *   pre-capture (`preCapture.server.ts`) -> capture (this file)
 *     -> post-capture (`postCapture.server.ts`)
 *
 * Two parts, run per DAILY-LOGS ENTRY (one per day+contributor pre-capture
 * has already staged — see `projectN01.server.ts`'s `listDailyLogEntries`
 * and the `phylog` skill's "Stage 1 — pre-capture" section), oldest first:
 *
 *   1. DETERMINISTIC FILING (`sorter.server.ts`'s `fileCardAttachments`,
 *      unchanged, still sourced from the ORIGINAL Card) — every
 *      not-yet-filed `::file{...}` Card attachment lands in the project's
 *      root. Deliberately NOT re-pointed at the daily-logs entry's own
 *      staged COPY of that attachment — see "Why filing still reads the
 *      original Card" below.
 *   2. ORGANIZE + README (an LLM agent loop, driven by the project's own
 *      `skills/CAPTURE.md`) — given the project's CURRENT file tree
 *      (everything outside `skills/`/`syncs/`/`newspapers/`/`daily-logs/`,
 *      which this stage never touches), the entry's own staged Card text
 *      (`card.md`) and pre-capture summaries (READ FROM THE ENTRY FOLDER,
 *      never the contributor's own vault or the live Card directly — see
 *      the `phylog` skill), and the current README, the model may call
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
 * WHY FILING STILL READS THE ORIGINAL CARD, not the daily-logs entry's
 * own staged copy: `fileCardAttachments` is SHARED with the Sorter
 * (`sorter.server.ts`'s `sortDailyLog`, `nopal sort run`), which files
 * attachments straight from the original Card into the project root
 * using a sourceRef keyed off the ORIGINAL attachment's own fileId. If
 * capture instead filed the daily-logs entry's own COPY (a different
 * fileId, made by pre-capture), the two would no longer agree on identity
 * and could each file a separate copy of the same photo into the project
 * root. Keeping capture's deterministic-filing step pointed at the
 * ORIGINAL Card preserves that existing dedup guarantee untouched; only
 * the AGENT's own context (Card text + summaries, read fresh from the
 * daily-logs entry folder) moved.
 *
 * TWO MODES:
 *   - Incremental (default): walks every daily-logs entry this project
 *     has, skipping any already recorded (idempotent against a hash of
 *     that entry's OWN staged content -- `_meta.md`'s `sourceHash`,
 *     refreshed by pre-capture every run) -- "just the entries that
 *     haven't been applied yet".
 *   - Full (`full: true`): first calls `resetProjectN01Content` (wiping
 *     everything this stage manages, and this project's own Release Log
 *     history -- see that function's own doc for why the latter is
 *     required) -- but, by DEFAULT, leaves `daily-logs` itself intact
 *     (see the `phylog` skill's "Reset" section for the two distinct
 *     reset depths), then walks EVERY entry from scratch. Always an
 *     explicit, separate operation from `nopal phylog reset` alone --
 *     reset only wipes; `capture --full` wipes AND rebuilds, straight
 *     from whatever's already staged in `daily-logs/` -- no need to
 *     re-run pre-capture first.
 *
 * ALWAYS APPLIES -- there is no preview/dry-run mode. The Release Log's
 * revert mechanism (`nopal release-log revert`) is the safety net.
 *
 * CROSS-HUMAN BY DESIGN: `runCapture`'s own `actingHumanId` parameter is
 * ONLY the human who triggered this run (used for the top-level "agent
 * not configured" style bookkeeping) -- it does NOT restrict which
 * daily-logs entries get processed. `listDailyLogEntries`
 * (`projectN01.server.ts`) enumerates every (day, contributor) entry
 * staged for THIS project, across every human whose Card was ever
 * pre-captured, and each entry is processed under ITS OWN humanId
 * (filing, README-writing, usage tracking, that human's own daily
 * release-log.md). This isn't a new trust boundary -- a Card was already
 * cross-human safe (any Sharing Role, including Observer, may write one
 * for a project they can see -- see the `vault` skill's Cards section,
 * and `sorter.server.ts`'s `fileCardAttachments`, which already filed a
 * collaborator's attachments into the project without needing write
 * access to their vault). Running capture used to silently only sweep
 * the CALLER's own Cards, which meant a project owner's own `phylog
 * capture` run could never see a collaborator's Card at all, no matter
 * how many times it ran -- fixed so any single owner-tier human running
 * this for a shared project applies EVERYONE's outstanding entries in one
 * pass, not just their own.
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

import {
  getDailyLogCards,
  getDailyLogFolderAndReadmeId,
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
import { splitFrontmatter, withReadmeBody } from "./project.types";
import {
  createReleaseLogEntry,
  findReleaseLogEntryBySource,
  regenerateDailyReleaseLog,
  regenerateProjectReleaseLog,
} from "./releaseLog.server";
import { fileCardAttachments, summaryFileName, type FiledAttachment } from "./sorter.server";
import {
  CARD_COPY_FILE,
  DEFAULT_CAPTURE_SKILL,
  getProjectStageSkill,
  listDailyLogEntries,
  listExtraSkillFiles,
  resetProjectN01Content,
  type ResetSummary,
} from "./projectN01.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyLlmError, recordPhylogUsage } from "./phylogMetrics.server";
import { getHumansById } from "./humans.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

const MANAGED_FOLDER_TYPES = new Set(["skills", "syncs", "newspapers", "daily-logs"]);

// ─── Tools ──────────────────────────────────────────────────────────────

const CREATE_FOLDER_TOOL: ToolDefinition = {
  name: "create_folder",
  description:
    "Create a folder (and any missing parent folders) inside this project, to organize filed content. Path is relative to the project root — e.g. \"Photos/2026-08\". Never targets skills/, syncs/, newspapers/, or daily-logs/ (reserved). If you plan to reference this folder from a ::gallery{folder=\"...\"} directive in the README, create it as a SINGLE, direct child of the project root (e.g. \"Hip Installation\", not \"Photos/Hip Installation\") — the gallery directive only resolves direct children by name, never nested paths.",
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
    "Move a file already filed in this project (by its current name) into a different folder inside the project. Creates the destination folder if it doesn't exist yet. Never targets skills/, syncs/, newspapers/, or daily-logs/.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The file's current name, exactly as it appears in the tree you were given." },
      destinationPath: { type: "string", description: "Relative destination folder path, e.g. \"Photos/2026-08\". Use \"\" for the project root." },
    },
    required: ["name", "destinationPath"],
  },
};

// Both write_file and update_readme accept their content as ONE OR MORE
// chunks rather than a single all-at-once string -- see this file's
// module doc / the phylog skill for why: a single response is capped at
// the provider's own output token limit, and a large README/file
// generated in one shot can get cut off mid-generation. Sending it as
// several smaller tool calls, each well under that limit, keeps any ONE
// call safely short regardless of how long the whole document ends up
// being. Most days the whole thing still fits in a single call --
// `chunk` is just the entire content and `done` is `true` immediately.
const CHUNK_PROTOCOL_NOTE =
  "Sent as one or more chunks: if the full content fits in a single call, send it all in one call with done: true. If it's long, call this tool repeatedly -- each call's chunk continues directly from your last one for this same target, in order, with no overlap -- and set done: true only on the LAST call, once everything has been sent.";

const WRITE_FILE_TOOL: ToolDefinition = {
  name: "write_file",
  description:
    `Create or fully replace a markdown reference file (never README.md -- use update_readme for that) at a path relative to the project root, e.g. "Electrical/panel-notes.md". Use this to move substantial, topic-specific detail OUT of README.md when keeping it inline would make the README unwieldy, then link to the file from the README with a normal markdown link. Folders in the path are created automatically. Never targets skills/, syncs/, newspapers/, or daily-logs/, and the path must end in .md and can't be named README.md. ${CHUNK_PROTOCOL_NOTE}`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the project root, e.g. \"notes/electrical.md\". Must end in .md. Use the exact same path on every chunk call for the same file." },
      chunk: { type: "string", description: "The next piece of this file's content, continuing directly from your last chunk for this path." },
      done: { type: "boolean", description: "True once this call's chunk completes the file's full content." },
    },
    required: ["path", "chunk", "done"],
  },
};

const UPDATE_README_TOOL: ToolDefinition = {
  name: "update_readme",
  description:
    `Replace the project's README.md BODY (everything after its front matter, if any) with a new version. Call this only when today's Card content, filed attachments, or reorganization actually warrant a real update -- skip it entirely on a day where nothing meaningfully changed. Never invent information that isn't grounded in the Card content, pre-capture summaries, or the README's own prior content. To display a GROUP of related photos as a photo grid instead of a bulleted list of links, use ::gallery{folder="<direct child folder name>" title="..."} -- see the system prompt's own explanation of this directive. ${CHUNK_PROTOCOL_NOTE}`,
  inputSchema: {
    type: "object",
    properties: {
      chunk: { type: "string", description: "The next piece of the replacement README body (markdown, front matter excluded), continuing directly from your last chunk." },
      done: { type: "boolean", description: "True once this call's chunk completes the full new body." },
      reason: { type: "string", description: "One sentence explaining what changed and why, for the Release Log. Only required on the call where done is true." },
    },
    required: ["chunk", "done"],
  },
};


async function runAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  tools: ToolDefinition[],
  executors: Record<string, (input: Record<string, unknown>) => Promise<string>>,
  maxTurns = 6,
): Promise<{
  toolCallsMade: ToolCall[];
  usage: LlmUsage;
  durationMs: number;
  model: string | null;
  finalText: string | null;
  /** True if ANY turn's generation was cut off by the model's own output
   * token limit before it finished. None of that turn's tool calls are
   * executed (see below) -- so this is purely informational for the
   * caller's own logging ("this run stopped early, re-run to pick up
   * where it left off"), never a signal that already-applied work needs
   * distrusting. */
  truncated: boolean;
}> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let finalText: string | null = null;
  let truncated = false;
  const loopStart = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await provider.complete({ system, messages, tools });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;
    if (response.text?.trim()) finalText = response.text.trim();
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.stopReason === "max_tokens") {
      // The model's generation was cut off mid-turn -- any tool call in
      // THIS response may carry incomplete or corrupted arguments, since
      // its own JSON may never have finished streaming (this is exactly
      // how a single-shot update_readme call was once observed producing
      // an empty README). None of this turn's tool calls are executed;
      // whatever was already committed by EARLIER, complete turns stands.
      truncated = true;
      break;
    }
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
  }
  return { toolCallsMade, usage, durationMs: Date.now() - loopStart, model, finalText, truncated };
}

/** Renders every folder/file in `projectFolder`'s tree EXCLUDING the
 * skills/syncs/newspapers/daily-logs subtrees — capture never touches,
 * and never even shows the model, the human-writable (skills/syncs) or
 * pre-capture-owned (daily-logs) parts of a project-n01 folder. */
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
 * skills/syncs/newspapers/daily-logs anchor by name. */
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
      return { ok: false, error: `"${segment}" is a reserved folder (skills/syncs/newspapers/daily-logs) and can't be used here` };
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

All three only resolve DIRECT children of the project root by name — never nested paths, never files/folders inside skills/syncs/newspapers/daily-logs.`;

function buildSystemPrompt(
  skillContent: string,
  generalSkill: string | null,
  extraSkillFiles: { name: string; content: string }[],
): string {
  const generalSection = generalSkill ? `\n\n## Project SKILL.md (general steering)\n\n${generalSkill}` : "";
  const extraSection = extraSkillFiles.length > 0
    ? `\n\n## Other reference files in this project's skills/ folder\n\nThese are additional, human-authored steering documents (e.g. a VOICE.md your CAPTURE.md instructions might tell you to follow) -- not the pipeline's own instruction files, just extra context the project owner wants every capture run to have. Follow anything in them exactly like the instructions above.\n\n${extraSkillFiles.map((f) => `### ${f.name}\n\n${f.content}`).join("\n\n")}`
    : "";
  return `You are PhyLog, capturing a project's daily work into a well-organized structure and an up-to-date README.

You will be given:
- This project's own CAPTURE.md instructions (and, if present, its general SKILL.md steering, plus any other reference files kept in skills/) — follow them closely.
- The project's CURRENT file tree (excluding its skills/syncs/newspapers/daily-logs folders, which you can never see or touch).
- That day's staged Card content (from this project's own daily-logs/ entry), and any files just filed into the project today.
- Pre-capture summaries for any of today's attachments, when available.
- The project's current README.md.

You may call create_folder / move_file any number of times to organize today's filed content, write_file any number of times to create or update a supporting markdown document, then update_readme (once its full new body has been sent -- see below) if the README genuinely needs to change. Most days, especially quiet ones, need no README change -- do nothing rather than making a cosmetic edit. Never fabricate progress, dates, or facts not grounded in what you were given.

Both write_file and update_readme accept their content in one or more chunks (see each tool's own description) -- on a quiet day the whole thing is one call, but this lets a genuinely long update go out safely across several calls instead of risking one oversized response. Separately, since README.md is meant to stay navigable as an index: when a topic has built up enough sustained, specific detail that keeping it inline would make the README unwieldy (a full build log, a long spec, an extended back-and-forth), move that detail into its own file with write_file (e.g. "Electrical/panel-notes.md") and link to it from the README with a normal markdown link, instead of inlining everything into one ever-growing document. Don't fragment for its own sake -- most days still belong directly in the README, and a short project should likely never need write_file at all.

${DIRECTIVE_GUIDE}

## Project CAPTURE.md

${skillContent}${generalSection}${extraSection}`;
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
  // Every (day, contributor) entry pre-capture has already staged for
  // this project -- see `listDailyLogEntries`'s own doc. Bounded to
  // `since`/`until` here (that helper itself is unbounded, since
  // `preCapture.server.ts`'s own `--date` mode needs a narrower,
  // date-only query shape it builds itself).
  const entries = (await listDailyLogEntries(projectFolder)).filter(({ meta }) => {
    if (opts.since && meta.date < opts.since) return false;
    if (meta.date > until) return false;
    return true;
  });
  if (entries.length === 0) {
    log(
      "capture: no daily-logs entries found for this project in range -- run `nopal phylog pre-capture` first.",
    );
    return { ok: true, full: opts.full, resetSummary, days: [] };
  }

  // Human-readable labels for the progress log only (never affects which
  // entries get processed) -- one batched lookup instead of one per entry.
  const humans = await getHumansById([...new Set(entries.map(({ meta }) => meta.humanId))]);
  const humanLabelById = new Map(humans.map((h) => [h._id, h.name || h.email]));
  const describeHuman = (id: string) => humanLabelById.get(id) ?? id;

  const skillContent = (await getProjectStageSkill(projectFolder, "CAPTURE.md")) ?? DEFAULT_CAPTURE_SKILL;
  // Backward-compat continuity: a project may already have a general
  // skills/SKILL.md predating this pipeline (the old README-writer's own
  // steering file) — fold it in too, alongside CAPTURE.md's own
  // instructions, rather than silently dropping it.
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  // Any other file dropped into skills/ (e.g. a VOICE.md CAPTURE.md
  // tells the model to "read and follow") -- fetched once per run and
  // folded into every day's prompt, never gated behind a tool call.
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
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

  for (const { folder: entryFolder, meta } of entries) {
    const { humanId: cardHumanId, date } = meta;
    const who = describeHuman(cardHumanId);

    // Deterministic filing still reads the ORIGINAL Card (not the
    // daily-logs entry's own staged copy) -- see this file's module doc
    // ("Why filing still reads the original Card") for why that's
    // required, not just convenient. A Card can vanish out from under an
    // already-staged entry (deleted, or the day's readme.md edited to
    // drop it) -- filing is simply skipped then, the agent step below
    // still runs off whatever's already staged in `daily-logs/`.
    const cards = await getDailyLogCards(cardHumanId, date);
    const card = cards.find((c) => c.projectFolderId === projectFolder._id);
    let filed: FiledAttachment[] = [];
    if (card) {
      log(`capture: ${date} (${who}) -- filing attachments...`);
      const result = await fileCardAttachments(card, date, cardHumanId, { dryRun: false });
      filed = result.filed;
      if (filed.length > 0) {
        releaseLogsDirty = true;
        touchedHumanDates.set(`${cardHumanId}:${date}`, cardHumanId);
        for (const f of filed) log(`capture: ${date} (${who}) -- filed "${f.name}".`);
      }
    } else {
      log(`capture: ${date} (${who}) -- original Card no longer exists; organizing from staged daily-logs content only.`);
    }

    // Idempotency keys off the ENTRY's own staged content hash
    // (`_meta.md.sourceHash`, refreshed by pre-capture every run) --
    // never the live Card directly, so this stays correct even for a
    // Card that's since been deleted (the entry's own hash simply stops
    // changing).
    const sourceRef = `${entryFolder._id}:${meta.sourceHash}`;
    const existing = await findReleaseLogEntryBySource(projectFolder._id, date, "ai-update", sourceRef);
    if (existing) {
      log(`capture: ${date} (${who}) -- already applied for this entry's current content.`);
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
        entryFolder,
        filed,
        sourceRef,
        llm,
        skillContent,
        generalSkill,
        extraSkillFiles,
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
  /** This (day, contributor)'s own daily-logs staging folder -- the
   * SOLE source of "today's content" for the agent below (never the
   * live Card or the contributor's own vault directly). */
  entryFolder: VaultFolder;
  filed: FiledAttachment[];
  sourceRef: string;
  llm: LlmProvider;
  skillContent: string;
  generalSkill: string | null;
  extraSkillFiles: { name: string; content: string }[];
  log: (line: string) => void;
}): Promise<{ readmeUpdated: boolean; organizeActions: string[] }> {
  const { actingHumanId, projectFolder, date, entryFolder, filed, sourceRef, llm, skillContent, generalSkill, extraSkillFiles, log } = input;

  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  const readmeContent = readme?.content ?? "";
  const tree = await renderManagedTree(projectFolder.human_id, projectFolder._id);

  // "Today's content" is read straight from the entry's own staged
  // files -- `card.md` (kept current by pre-capture) plus every
  // generated `*-summary.md` sibling -- never `card.content`/the
  // contributor's own vault. See this file's module doc.
  const { files: entryFiles } = await listFolderChildren(entryFolder.human_id, entryFolder._id);
  const cardCopyListing = entryFiles.find((f) => f.name === CARD_COPY_FILE);
  const cardCopyFile = cardCopyListing ? await getFileRefById(cardCopyListing._id) : undefined;
  const cardContent = cardCopyFile?.content ?? "";

  const summaries: { name: string; body: string }[] = [];
  for (const f of filed) {
    const listing = entryFiles.find((s) => s.name === summaryFileName(f.name));
    if (!listing) continue;
    const file = await getFileRefById(listing._id);
    if (file?.content) summaries.push({ name: f.name, body: splitFrontmatter(file.content).body.trim() });
  }

  const organizeActions: string[] = [];
  // Chunk buffers -- see CHUNK_PROTOCOL_NOTE above. Keyed by lowercased
  // path for write_file (one buffer per target file this turn loop
  // touches); README has exactly one target so it's just an array.
  const readmeChunks: string[] = [];
  let readmeDone = false;
  let readmeReason = "";
  const fileChunks = new Map<string, string[]>();
  const executors: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    create_folder: async (input) => {
      const path = String(input.path ?? "");
      const result = await resolveOrCreatePath(projectFolder, path);
      if (!result.ok) return `Error: ${result.error}`;
      organizeActions.push(`created folder "${path}"`);
      log(`capture: ${date} -- created folder "${path}".`);
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
      log(`capture: ${date} -- moved "${name}" to "${destinationPath || "/"}".`);
      return `Moved "${name}" to ${destinationPath || "/"}`;
    },
    write_file: async (input) => {
      const rawPath = String(input.path ?? "").trim();
      const chunk = String(input.chunk ?? "");
      const done = Boolean(input.done);
      const segments = rawPath.split("/").map((s) => s.trim()).filter(Boolean);
      const fileName = segments[segments.length - 1];
      if (!fileName) return "Error: no file name given";
      if (!fileName.toLowerCase().endsWith(".md")) return "Error: write_file can only create markdown (.md) files";
      if (fileName.toLowerCase() === "readme.md") return "Error: use update_readme to change README.md, not write_file";

      const key = rawPath.toLowerCase();
      const buffered = fileChunks.get(key) ?? [];
      buffered.push(chunk);
      fileChunks.set(key, buffered);
      if (!done) {
        return `Chunk received for "${rawPath}" (${buffered.join("").length} chars so far). Send the next chunk, or call again with done: true when finished.`;
      }

      const content = buffered.join("");
      fileChunks.delete(key);
      const dir = await resolveOrCreatePath(projectFolder, segments.slice(0, -1).join("/"));
      if (!dir.ok) return `Error: ${dir.error}`;
      const { files: dirFiles } = await listFolderChildren(projectFolder.human_id, dir.folderId);
      const existing = dirFiles.find((f) => f.name.toLowerCase() === fileName.toLowerCase());
      if (existing) {
        await updateFileRef(existing._id, { content });
      } else {
        await createFileRef({
          human_id: projectFolder.human_id,
          name: fileName,
          content,
          content_type: "text/markdown",
          folder_id: dir.folderId,
        });
      }
      organizeActions.push(`wrote "${rawPath}"`);
      log(`capture: ${date} -- wrote "${rawPath}".`);
      return `${existing ? "Updated" : "Created"} ${rawPath}`;
    },
    update_readme: async (input) => {
      const chunk = String(input.chunk ?? "");
      const done = Boolean(input.done);
      readmeChunks.push(chunk);
      if (done) {
        readmeDone = true;
        readmeReason = String(input.reason ?? "").trim();
        return "Final chunk received -- README will be updated once you're done with any other tools. Don't call update_readme again this run.";
      }
      return `Chunk received (${readmeChunks.join("").length} chars so far). Send the next chunk, or call again with done: true when finished.`;
    },
  };

  const userPrompt = buildUserPrompt({ tree, cardContent, filed, summaries, readmeContent });
  const { toolCallsMade, usage, durationMs, model, finalText, truncated } = await runAgentLoop(
    llm,
    buildSystemPrompt(skillContent, generalSkill, extraSkillFiles),
    userPrompt,
    [CREATE_FOLDER_TOOL, MOVE_FILE_TOOL, WRITE_FILE_TOOL, UPDATE_README_TOOL],
    executors,
    // Higher than runAgentLoop's own default (6): chunked README/file
    // writes (see CHUNK_PROTOCOL_NOTE) can take several turns on their
    // own on a big update, on top of any create_folder/move_file calls.
    16,
  );

  if (truncated) {
    log(
      `capture: ${date} -- the model's generation was cut off by its own output token limit before it finished; whatever it had already done this run stands, but its last, incomplete action was discarded. Re-run capture to pick up where it left off.`,
    );
  }

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

  // `readmeChunks` accumulates across every complete (non-truncated) turn
  // that called update_readme -- see runAgentLoop's own truncation
  // handling for why a turn that got cut off never reaches here at all.
  const wroteReadmeChunks = readmeChunks.length > 0;
  let readmeUpdated = false;
  let refusalReason: string | null = null;
  if (wroteReadmeChunks && !readmeDone) {
    // The loop ended (ran out of turns, or the model just stopped) before
    // a final done:true chunk ever arrived -- what's buffered is a
    // deliberately incomplete fragment, never something to apply.
    refusalReason = "it never finished sending the new body (ran out of turns before a final chunk arrived), so what it sent can't be trusted";
  } else if (wroteReadmeChunks) {
    const candidateBody = readmeChunks.join("").trim();
    const oldBodyForCheck = splitFrontmatter(readmeContent).body.trim();
    const todayHadContent = cardContent.trim().length > 0 || summaries.some((s) => s.body.trim().length > 0);
    if (candidateBody.length === 0 && (oldBodyForCheck.length > 0 || todayHadContent)) {
      refusalReason = "it returned an empty body while the project (or today's log) has real content";
    }
  }
  if (wroteReadmeChunks && !refusalReason) {
    const newBody = readmeChunks.join("");
    const reason = readmeReason || "(no reason given)";
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
        summary: `PhyLog captured the day -- [View](/fruits/vault?file=${readmeFileId}): ${reason}${actionSummary}`,
        sourceRef,
        changesets: [
          { fileId: readmeFileId, action: "content-edit", before: { content: oldFullContent }, after: { content: newFullContent } },
        ],
      });
      readmeUpdated = true;
      log(`capture: ${date} -- README updated: ${reason}`);
    }
  } else {
    if (refusalReason) {
      log(`capture: ${date} -- refused to apply update_readme (${refusalReason}); README left unchanged.`);
    }
    if (organizeActions.length > 0) {
      // Reorganization happened without a README change -- still worth a
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
    } else if (!refusalReason) {
      // Nothing changed at all -- without this, "why didn't my README
      // update" is undiagnosable, since the model's own reasoning for
      // abstaining is otherwise thrown away. Log it verbatim.
      log(
        finalText
          ? `capture: ${date} -- no README update or reorganization; model said: ${finalText}`
          : `capture: ${date} -- no README update or reorganization (model gave no reasoning text).`,
      );
    }
  }

  return { readmeUpdated, organizeActions };
}
