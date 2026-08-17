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
import { joinReadmeSections, splitFrontmatter, splitReadmeSections, withReadmeBody } from "./project.types";
import {
  createReleaseLogEntry,
  findReleaseLogEntryBySource,
  regenerateDailyReleaseLog,
  regenerateProjectReleaseLog,
} from "./releaseLog.server";
import { fileCardAttachments, summaryFileName, type FiledAttachment } from "./sorter.server";
import {
  CARD_COPY_FILE,
  getProjectStageSkill,
  listDailyLogEntries,
  listExtraSkillFiles,
  resetProjectN01Content,
  writeDailyLogEntryMeta,
  type DailyLogEntryMeta,
  type ResetSummary,
} from "./projectN01.server";
import { getEffectiveDefaultSkill } from "./phylogDefaults.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyLlmError, recordPhylogUsage } from "./phylogMetrics.server";
import { getHumansById } from "./humans.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

const MANAGED_FOLDER_TYPES = new Set(["skills", "syncs", "newspapers", "daily-logs"]);

/** Human-readable wall-clock duration for `runCapture`'s own completion
 * log line -- e.g. "1m 12.3s" or "8.4s". Not reused elsewhere; if a
 * second caller needs this, promote it to a shared util instead of
 * copying. */
function formatDurationMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

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

// write_file, update_section, and update_readme all accept their content
// as ONE OR MORE chunks rather than a single all-at-once string -- see
// this file's module doc / the phylog skill for why: a single response
// is capped at the provider's own output token limit, and a large
// README section/file generated in one shot can get cut off
// mid-generation. Sending it as several smaller tool calls, each well
// under that limit, keeps any ONE call safely short regardless of how
// long the whole thing ends up being. Most days the whole thing still
// fits in a single call -- `chunk` is just the entire content and `done`
// is `true` immediately. (`remove_section` takes no content at all, so
// it never needs this.)
const CHUNK_PROTOCOL_NOTE =
  "Sent as one or more chunks: if the full content fits in a single call, send it all in one call with done: true. Don't try to judge whether it 'fits' -- as a concrete rule of thumb, if a section/file's content would run longer than roughly 600-800 words (about a page), split it into multiple chunk calls rather than attempting it in one. When you do split, call this tool repeatedly -- each call's chunk continues directly from your last one for this same target, in order, with no overlap -- and set done: true only on the LAST call, once everything has been sent. If a turn would also need other tool calls (create_folder, move_file, etc.) alongside a long write, make those in a separate turn from the long write so the write has that turn's full output budget to itself.";

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

const UPDATE_SECTION_TOOL: ToolDefinition = {
  name: "update_section",
  description:
    `Replace (or create) ONE section of the project's README.md, identified by its exact "## Heading" text. This is the PRIMARY way to change the README -- most days touch one or a few sections, not the whole document, and this bounds an edit's blast radius to just the section that actually changed. Use heading: "" for the INTRO (everything before the first "## " heading, including any title). If no section with this heading exists yet, one is created and appended at the end. Sending empty content for a section that currently has real content is REFUSED (use remove_section instead, an explicit and separate action). Never invent information that isn't grounded in the Card content, pre-capture summaries, or the README's own prior content. To display a GROUP of related photos as a photo grid instead of a bulleted list of links, use ::gallery{folder="<direct child folder name>" title="..."} -- see the system prompt's own explanation of this directive. ${CHUNK_PROTOCOL_NOTE}`,
  inputSchema: {
    type: "object",
    properties: {
      heading: { type: "string", description: "The exact '## ' heading text of the section to replace, matched case-insensitively (or \"\" for the intro). Use the SAME heading on every chunk call for the same section." },
      chunk: { type: "string", description: "The next piece of this section's content (markdown, NOT including the '## heading' line itself), continuing directly from your last chunk for this heading." },
      done: { type: "boolean", description: "True once this call's chunk completes the section's full content." },
    },
    required: ["heading", "chunk", "done"],
  },
};

const REMOVE_SECTION_TOOL: ToolDefinition = {
  name: "remove_section",
  description:
    "Deletes one section of README.md entirely, by its exact '## Heading' text (matched case-insensitively). A deliberate, explicit action -- distinct from update_section with empty content, which is refused. Only remove a section when it's genuinely obsolete, not just because today's log didn't happen to mention it -- see the project's own CAPTURE.md for when removal is actually appropriate.",
  inputSchema: {
    type: "object",
    properties: {
      heading: { type: "string", description: "The exact '## ' heading text of the section to remove." },
    },
    required: ["heading"],
  },
};

const UPDATE_README_TOOL: ToolDefinition = {
  name: "update_readme",
  description:
    `Replace the project's README.md BODY (everything after its front matter, if any) with a new version, ALL AT ONCE. Reserved for FULL reorganizations -- when the file has genuinely become hard to navigate and section boundaries themselves need to change, or the README is empty and this is the very first pass. For ordinary day-to-day updates, prefer update_section: it only touches the section that actually changed, which is cheaper and safer. Never invent information that isn't grounded in the Card content, pre-capture summaries, or the README's own prior content. To display a GROUP of related photos as a photo grid instead of a bulleted list of links, use ::gallery{folder="<direct child folder name>" title="..."} -- see the system prompt's own explanation of this directive. ${CHUNK_PROTOCOL_NOTE}`,
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

// Daily capture's own signal for triggering the SEPARATE, dedicated
// `runReorganize` pass (below) -- deliberately NOT the same thing as the
// daily agent deciding on its own that structure could be better. This
// tool exists so an EXPLICIT request in that day's own log (someone
// journaling "we should reorganize this project") reliably kicks off a
// pass with full visibility into the whole README, rather than hoping
// the day's own narrow, one-log-at-a-time pass does that work itself.
const REQUEST_REORGANIZE_TOOL: ToolDefinition = {
  name: "request_reorganize",
  description:
    'Call this if -- and ONLY if -- today\'s own log content explicitly asks for the project\'s structure or organization to be reconsidered (e.g. "we should reorganize this project" or "the README is getting messy, let\'s restructure by phase"). This queues a SEPARATE, dedicated reorganization pass with full visibility into the entire current README, run right after today\'s own edits -- it is NOT the same as you personally deciding the structure could be improved; only call it when today\'s log itself is asking for it. Call it at most once per day.',
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "A short quote or paraphrase of what in today's log is asking for this, for the Release Log." },
    },
    required: ["reason"],
  },
};


// A single turn hitting the provider's own per-call output limit
// (`stopReason: "max_tokens"") used to just end the WHOLE agent loop on
// the spot -- a real, confirmed problem: re-running `capture` from
// scratch afterward hands the model the exact same content and the exact
// same (vague, self-judged) chunking instructions, so it frequently made
// the exact same oversized attempt and truncated again, for MULTIPLE
// separate `capture` invocations in a row, on MULTIPLE different days,
// with zero progress made between them. Retrying IN-LOOP, with an
// explicit correction ("that was too big, split it smaller -- here's
// roughly how much room you actually have"), fixes this at the source
// instead of pushing an unfixable retry onto a future, unrelated run.
// Bounded (not unlimited) so a model that keeps mis-judging its own
// output regardless of correction still eventually falls through to the
// existing safety net below (discard + `truncated: true`, retried on a
// future `capture` run) rather than looping forever.
const MAX_TRUNCATION_RETRIES = 3;

async function runAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  tools: ToolDefinition[],
  executors: Record<string, (input: Record<string, unknown>) => Promise<string>>,
  maxTurns = 6,
  /** Passed straight through to every `provider.complete()` call --
   * true when the CALLER (`runCapture`) already knows this project's
   * system prompt will be reused by another day's entry in this same
   * run. See `llmProvider.ts`'s own doc on the field for why this can't
   * be decided from inside the loop itself. */
  cacheSystemPrompt = false,
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
  /** How many times a turn hit the output-token ceiling AND was
   * automatically retried with a smaller-chunks correction (see
   * `MAX_TRUNCATION_RETRIES` above) -- regardless of whether a retry
   * eventually succeeded (`truncated: false`) or every retry was
   * exhausted (`truncated: true`). Purely informational, for the
   * caller's own logging -- lets "this ran cleanly" and "this ran, but
   * only after the model overshot and had to be corrected" stay
   * distinguishable, without treating the latter as an error. */
  truncationRetries: number;
  /** True if the loop ran all the way to maxTurns while the model's LAST
   * turn still ended with stopReason "tool_use" -- i.e. it looked like it
   * had more to do, and we simply stopped asking. Distinct from
   * `truncated` (a single response cut off by the PROVIDER's own output
   * limit); this is OUR OWN turn budget running out instead. */
  hitMaxTurns: boolean;
}> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let finalText: string | null = null;
  let truncated = false;
  let truncationRetries = 0;
  let hitMaxTurns = false;
  const loopStart = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await provider.complete({ system, messages, tools, cacheSystemPrompt });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;
    if (response.stopReason === "max_tokens") {
      // The model's generation was cut off mid-turn -- any tool call in
      // THIS response may carry incomplete or corrupted arguments, since
      // its own JSON may never have finished streaming (this is exactly
      // how a single-shot update_readme call was once observed producing
      // an empty README). None of this turn's tool calls are executed.
      if (truncationRetries < MAX_TRUNCATION_RETRIES) {
        truncationRetries++;
        // Deliberately DO NOT push this turn's own (incomplete, possibly
        // corrupted) assistant message -- an unexecuted `tool_use` block
        // with no matching `tool_result` would make the NEXT API call
        // invalid. Instead, just tell the model what happened and retry.
        // Sized off what THIS call actually, observably fit before
        // running out -- self-discovering the real ceiling instead of
        // hardcoding a provider-specific number into this provider-
        // agnostic loop. ESCALATES with each successive retry (divisor
        // grows: 3, 4, 5, ...) rather than repeating the same target
        // every time -- `observedBudget` alone doesn't escalate on its
        // own, since a turn that truncates lands at roughly the SAME
        // provider ceiling every time, retry after retry, so giving the
        // model the exact same (already-ignored) instruction twice in a
        // row was a real, confirmed gap: a day whose content genuinely
        // needed a smaller target than the first correction asked for
        // just kept truncating identically, retry after retry, run after
        // run, with zero progress.
        const observedBudget = response.usage.outputTokens || 0;
        const divisor = 2 + truncationRetries;
        const targetChunkTokens = Math.max(200, Math.floor(observedBudget / divisor));
        const escalation = truncationRetries > 1
          ? ` This is retry ${truncationRetries} -- your previous, larger target ALSO got cut off, so go smaller still, and make ONLY ONE tool call this turn (nothing else), even if that means several more turns are needed to finish.`
          : "";
        messages.push({
          role: "user",
          content: `Your last response was cut off by this call's own output limit after about ${observedBudget} tokens, before it finished -- nothing from it was applied. Retry the same work, but this time send it in noticeably smaller pieces: aim for roughly ${targetChunkTokens} tokens (very roughly ${targetChunkTokens * 4} characters) per tool call at most, calling the relevant tool repeatedly with done: false until everything is sent, and done: true only on the truly last piece. If you were also making other tool calls (create_folder, move_file, etc.) in the same turn as the long write, do those separately so the write has that turn's full output budget to itself.${escalation}`,
        });
        continue;
      }
      // Retries exhausted (or none configured) -- fall back to the
      // existing safety net: whatever was already committed by EARLIER,
      // complete turns stands, this turn's own tool calls are discarded,
      // and the caller retries on a future run.
      if (response.text?.trim()) finalText = response.text.trim();
      messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
      truncated = true;
      break;
    }
    if (response.text?.trim()) finalText = response.text.trim();
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === maxTurns - 1) {
      // The for-loop's own condition ends things here -- but the model's
      // last turn wanted to keep going (stopReason "tool_use"), so
      // whatever it intended to do next never happened.
      hitMaxTurns = true;
    }
  }
  return { toolCallsMade, usage, durationMs: Date.now() - loopStart, model, finalText, truncated, truncationRetries, hitMaxTurns };
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

You may call create_folder / move_file any number of times to organize today's filed content, write_file any number of times to create or update a supporting markdown document, and update_section / remove_section any number of times to edit README.md one section at a time. Never fabricate progress, dates, or facts not grounded in what you were given.

update_section, identified by its exact "## Heading" text (or "" for the intro before the first heading), touches only the one section that actually changed -- reach for the whole-document update_readme instead when section boundaries themselves need to change, not just their content.

update_section/remove_section/update_readme/write_file all accept their content in one or more chunks (see each tool's own description) -- on a quiet day the whole thing is one call, but this lets a genuinely long update go out safely across several calls instead of risking one oversized response.

How much a given day changes -- whether that's nothing, a section edit, moving detail into its own file with write_file, or reorganizing section boundaries entirely -- is a judgment call this project's OWN CAPTURE.md instructions below are the real authority on. Take them at their word: if they describe an organization strategy, a threshold for splitting content out, or when reorganizing is warranted, follow that directly rather than defaulting to caution. Only fall back to "most days need no change, and a short project rarely needs write_file" as a general default when CAPTURE.md doesn't say anything more specific.

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
  | { ok: true; full: boolean; resetSummary?: ResetSummary; days: CaptureDayResult[]; durationMs: number }
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

  // Wall-clock time for the WHOLE invocation (queue wait time isn't part
  // of this -- the job's already been picked up by the worker by the
  // time this function starts -- but a `--full` reset, walking every
  // daily-logs entry, and every real LLM call along the way all are).
  // Purely informational, logged and returned alongside the rest of this
  // run's result -- never affects any decision this function makes.
  const startedAt = Date.now();

  let resetSummary: ResetSummary | undefined;
  if (opts.full) {
    log("capture: --full — resetting project-managed content before rebuilding…");
    resetSummary = await resetProjectN01Content(projectFolder);
    log(
      `capture: reset removed ${resetSummary.deletedFolders.length} folder(s) and ${resetSummary.deletedFiles.length} file(s).`,
    );
  }

  const until = opts.until ?? new Date().toISOString().slice(0, 10);
  // Every (day, contributor) entry pre-ckapture has already staged for
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
    return { ok: true, full: opts.full, resetSummary, days: [], durationMs: Date.now() - startedAt };
  }

  // Human-readable labels for the progress log only (never affects which
  // entries get processed) -- one batched lookup instead of one per entry.
  const humans = await getHumansById([...new Set(entries.map(({ meta }) => meta.humanId))]);
  const humanLabelById = new Map(humans.map((h) => [h._id, h.name || h.email]));
  const describeHuman = (id: string) => humanLabelById.get(id) ?? id;

  const skillContent = (await getProjectStageSkill(projectFolder, "CAPTURE.md")) ?? (await getEffectiveDefaultSkill("capture"));
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
  // Counts REAL captureOneDay invocations only (never already-applied
  // skips) -- see llmProvider.ts's own doc on cacheSystemPrompt. Using
  // entries.length here instead would be wrong: it counts every entry
  // ever staged for this project, which only grows over time and would
  // make caching "worth it" forever after a project's first couple of
  // days, even on a run where just ONE fresh entry actually reaches the
  // LLM. Marking system-prompt caching from the SECOND real call onward
  // (never the first) needs no lookahead at all -- a truly single-call
  // run correctly never pays the write premium, and any run with 3+
  // calls still gets the full benefit (only the 2nd call's write is ever
  // "wasted," same as any first sighting of a new cache key has to be).
  let realCaptureCallsSoFar = 0;
  // At most one dedicated reorganization pass per runCapture invocation,
  // even if multiple days/entries each request one -- see runReorganize's
  // own doc. Tracks the request that WON so the log can say what
  // triggered it even if a later request was the one that got skipped.
  let reorganizeRanThisRun = false;

  for (const { folder: entryFolder, meta } of entries) {
    const { humanId: cardHumanId, date } = meta;
    const who = describeHuman(cardHumanId);

    // Idempotency keys off the ENTRY's own staged content hash
    // (`_meta.md.sourceHash`, refreshed by pre-capture every run) --
    // never the live Card directly, so this stays correct even for a
    // Card that's since been deleted (the entry's own hash simply stops
    // changing). Checked BEFORE filing, not after -- see below.
    const sourceRef = `${entryFolder._id}:${meta.sourceHash}`;

    // THREE ways an entry can already be "done," checked cheapest-first:
    //   1. `capturedAppliedSourceHash`/`capturedNoOpSourceHash` (see their
    //      own docs, `projectN01.server.ts`) match the entry's CURRENT
    //      `sourceHash` -- a pure in-memory comparison against data
    //      `listDailyLogEntries` already fetched, no extra I/O at all.
    //      This is the fast path, and it's the ONLY check that runs for
    //      the overwhelming majority of entries on any incremental run
    //      against a project with real history: once an entry is
    //      settled, it costs nothing ever again, instead of one database
    //      round trip per entry on every single future run forever.
    //   2. Otherwise, fall back to a `findReleaseLogEntryBySource` lookup
    //      -- needed for an entry that predates these markers, or that
    //      got applied through some path that hasn't backfilled them
    //      yet. A match here backfills `capturedAppliedSourceHash` so
    //      every FUTURE run for this exact entry hits the fast path
    //      instead of repeating this same database round trip.
    const fastPathApplied = meta.capturedAppliedSourceHash === meta.sourceHash;
    const fastPathNoOp = !fastPathApplied && meta.capturedNoOpSourceHash === meta.sourceHash;
    let alreadySettled = fastPathApplied || fastPathNoOp;
    if (!alreadySettled) {
      const existingEntry = await findReleaseLogEntryBySource(projectFolder._id, date, "ai-update", sourceRef);
      if (existingEntry) {
        alreadySettled = true;
        await writeDailyLogEntryMeta(entryFolder, { ...meta, capturedAppliedSourceHash: meta.sourceHash });
      }
    }
    if (alreadySettled) {
      log(
        fastPathNoOp
          ? `capture: ${date} (${who}) -- already reviewed this entry's current content; nothing needed to change.`
          : `capture: ${date} (${who}) -- already applied for this entry's current content.`,
      );
      await recordPhylogUsage({
        humanId: cardHumanId,
        projectFolderId: projectFolder._id,
        stage: "capture",
        kind: "organize",
        durationMs: 0,
        outcome: "skipped",
      });
      days.push({ date, humanId: cardHumanId, filed: [], organizeActions: [], readmeUpdated: false, alreadyApplied: true });
      continue;
    }

    // Deterministic filing still reads the ORIGINAL Card (not the
    // daily-logs entry's own staged copy) -- see this file's module doc
    // ("Why filing still reads the original Card") for why that's
    // required, not just convenient. A Card can vanish out from under an
    // already-staged entry (deleted, or the day's readme.md edited to
    // drop it) -- filing is simply skipped then, the agent step below
    // still runs off whatever's already staged in `daily-logs/`. Only
    // reached once we know above that this entry ISN'T already settled --
    // an already-settled entry's `sourceHash` already covers every
    // current attachment (see Stage 1's own doc), so there's nothing new
    // to file for it either.
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

    const cacheSystemPrompt = realCaptureCallsSoFar > 0;
    realCaptureCallsSoFar++;

    let readmeUpdated = false;
    let organizeActions: string[] = [];
    try {
      const result = await captureOneDay({
        actingHumanId: cardHumanId,
        projectFolder,
        date,
        entryFolder,
        entryMeta: meta,
        filed,
        sourceRef,
        llm,
        skillContent,
        generalSkill,
        extraSkillFiles,
        cacheSystemPrompt,
        log,
      });
      readmeUpdated = result.readmeUpdated;
      organizeActions = result.organizeActions;
      if (readmeUpdated || organizeActions.length > 0) {
        releaseLogsDirty = true;
        touchedHumanDates.set(`${cardHumanId}:${date}`, cardHumanId);
        // Fast-path marker for every FUTURE run -- see this field's own
        // doc (`projectN01.server.ts`) and the skip check at the top of
        // this loop. Written the moment a real change is committed, so a
        // future run never needs the slower `findReleaseLogEntryBySource`
        // fallback for this entry at all.
        await writeDailyLogEntryMeta(entryFolder, { ...meta, capturedAppliedSourceHash: meta.sourceHash });
      } else if (!result.reorganizeRequested) {
        log(`capture: ${date} (${who}) -- no README update or reorganization warranted.`);
      }

      if (result.reorganizeRequested) {
        if (reorganizeRanThisRun) {
          log(
            `capture: ${date} (${who}) -- also requested a reorganization, but one already ran this invocation; skipping the duplicate.`,
          );
        } else {
          reorganizeRanThisRun = true;
          log(`capture: ${date} (${who}) -- running the requested reorganization pass...`);
          const reorgResult = await runReorganize(
            cardHumanId,
            projectFolder,
            { llm, reason: result.reorganizeRequested.reason, date, sourceRef: `${sourceRef}:reorganize` },
            log,
          );
          if (!reorgResult.ok) {
            log(`capture: ${date} (${who}) -- reorganization pass failed: ${reorgResult.error}`);
          } else {
            if (reorgResult.changed) {
              releaseLogsDirty = true;
              touchedHumanDates.set(`${cardHumanId}:${date}`, cardHumanId);
            }
            if (!reorgResult.incomplete) {
              await writeDailyLogEntryMeta(entryFolder, { ...meta, capturedNoOpSourceHash: meta.sourceHash });
            }
          }
        }
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

  const durationMs = Date.now() - startedAt;
  log(`capture: done in ${formatDurationMs(durationMs)} (${days.length} entr${days.length === 1 ? "y" : "ies"} processed).`);

  return { ok: true, full: opts.full, resetSummary, days, durationMs };
}

/**
 * The README/file-mutating tool executors (write_file/update_section/
 * remove_section/update_readme) -- shared by `captureOneDay`'s daily
 * agent loop AND `runReorganize`'s dedicated pass (below), so the exact
 * same safety nets (chunk buffering, the empty-content refusal, everything
 * committing immediately and building on the PREVIOUS tool's own result --
 * see this file's module doc) exist in exactly ONE place instead of two
 * copies that could drift out of sync. `create_folder`/`move_file` are
 * included too since they're already generic (no per-day state), even
 * though they're not README-specific -- keeping all six tools' executors
 * together in one factory is simpler than splitting further.
 */
function createReadmeAndFileExecutors(input: {
  projectFolder: VaultFolder;
  log: (line: string) => void;
  /** Prefixes every inline log line -- `capture: ${date}` for the daily
   * pass, `reorganize` for the dedicated pass. */
  logPrefix: string;
  initialReadmeContent: string;
  initialReadmeFileId: string | undefined;
  /** Extra justification for refusing an empty update_section/update_readme
   * result, alongside "the CURRENT target already has content" -- the
   * daily pass also refuses when today's own Card/summary content is
   * non-empty (something to lose even if the target itself was already
   * blank); the reorganize pass has no "today" and always passes false. */
  freshContentPresent: boolean;
}): {
  executors: Record<string, (input: Record<string, unknown>) => Promise<string>>;
  organizeActions: string[];
  readmeEditSummaries: string[];
  hadRefusal: () => boolean;
  /** A chunk sequence that received at least one chunk but never a final
   * done: true before the loop ended -- see runAgentLoop's own
   * turn-level truncation skip for why this can still happen even though
   * nothing partial ever actually commits. */
  hadIncompleteAttempt: () => boolean;
  getCurrentReadme: () => { content: string; fileId: string | undefined };
} {
  const { projectFolder, log, logPrefix, initialReadmeContent, initialReadmeFileId, freshContentPresent } = input;
  const organizeActions: string[] = [];
  let currentReadmeContent = initialReadmeContent;
  let currentReadmeFileId = initialReadmeFileId;
  const readmeEditSummaries: string[] = [];
  let hadRefusal = false;

  async function commitReadmeContent(newFullContent: string): Promise<boolean> {
    if (!currentReadmeFileId) {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: "README.md",
        content: newFullContent,
        content_type: "text/markdown",
        folder_id: projectFolder._id,
      });
      if (!created) return false;
      currentReadmeFileId = created._id;
    } else {
      await updateFileRef(currentReadmeFileId, { content: newFullContent });
    }
    currentReadmeContent = newFullContent;
    return true;
  }

  const fileChunks = new Map<string, string[]>();
  const sectionChunks = new Map<string, string[]>();
  const readmeWholeChunks: string[] = [];

  const executors: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    create_folder: async (input) => {
      const path = String(input.path ?? "");
      const result = await resolveOrCreatePath(projectFolder, path);
      if (!result.ok) return `Error: ${result.error}`;
      organizeActions.push(`created folder "${path}"`);
      log(`${logPrefix} -- created folder "${path}".`);
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
      log(`${logPrefix} -- moved "${name}" to "${destinationPath || "/"}".`);
      return `Moved "${name}" to ${destinationPath || "/"}`;
    },
    write_file: async (input) => {
      const rawPath = String(input.path ?? "").trim();
      const chunk = String(input.chunk ?? "");
      // Strict `=== true`, not `Boolean(...)` -- a model that emits the
      // STRING "false" (schema violation, but seen from LLMs) would
      // otherwise coerce to true (any non-empty string is truthy in JS),
      // wrongly treating an unfinished write as complete.
      const done = input.done === true;
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
      log(`${logPrefix} -- wrote "${rawPath}".`);
      return `${existing ? "Updated" : "Created"} ${rawPath}`;
    },
    update_section: async (input) => {
      const heading = String(input.heading ?? "").trim();
      const chunk = String(input.chunk ?? "");
      const done = input.done === true; // see write_file's own note on why not Boolean(...)
      const key = heading.toLowerCase();
      const buffered = sectionChunks.get(key) ?? [];
      buffered.push(chunk);
      sectionChunks.set(key, buffered);
      if (!done) {
        return `Chunk received for section "${heading || "(intro)"}" (${buffered.join("").length} chars so far). Send the next chunk, or call again with done: true when finished.`;
      }

      const content = buffered.join("");
      sectionChunks.delete(key);
      const sections = splitReadmeSections(splitFrontmatter(currentReadmeContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      const existing = existingIndex === -1 ? null : sections[existingIndex];

      if (content.trim().length === 0 && existing && existing.content.trim().length > 0) {
        hadRefusal = true;
        const label = heading || "(intro)";
        log(`${logPrefix} -- refused update_section "${label}" (would erase real content with an empty section); left unchanged.`);
        return `Error: refused -- section "${label}" currently has real content; sending empty content would erase it. Use remove_section if you genuinely want to delete it.`;
      }

      const updatedSections = existing
        ? sections.map((s, i) => (i === existingIndex ? { heading: existing.heading, content } : s))
        : [...sections, { heading, content }];
      const ok = await commitReadmeContent(withReadmeBody(currentReadmeContent, joinReadmeSections(updatedSections)));
      if (!ok) return "Error: failed to save section update";
      const label = heading || "(intro)";
      readmeEditSummaries.push(existing ? `updated "${label}"` : `added "${label}"`);
      log(`${logPrefix} -- ${existing ? "updated" : "added"} README section "${label}".`);
      return `${existing ? "Updated" : "Added"} section "${label}".`;
    },
    remove_section: async (input) => {
      const heading = String(input.heading ?? "").trim();
      const key = heading.toLowerCase();
      const sections = splitReadmeSections(splitFrontmatter(currentReadmeContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      if (existingIndex === -1) return `Error: no section named "${heading}" found`;
      const updatedSections = sections.filter((_, i) => i !== existingIndex);
      const ok = await commitReadmeContent(withReadmeBody(currentReadmeContent, joinReadmeSections(updatedSections)));
      if (!ok) return "Error: failed to remove section";
      readmeEditSummaries.push(`removed "${heading}"`);
      log(`${logPrefix} -- removed README section "${heading}".`);
      return `Removed section "${heading}".`;
    },
    update_readme: async (input) => {
      const chunk = String(input.chunk ?? "");
      const done = input.done === true; // see write_file's own note on why not Boolean(...)
      readmeWholeChunks.push(chunk);
      if (!done) {
        return `Chunk received (${readmeWholeChunks.join("").length} chars so far). Send the next chunk, or call again with done: true when finished.`;
      }

      const newBody = readmeWholeChunks.join("");
      readmeWholeChunks.length = 0;
      const reason = String(input.reason ?? "").trim() || "(no reason given)";
      const oldBody = splitFrontmatter(currentReadmeContent).body.trim();
      if (newBody.trim().length === 0 && (oldBody.length > 0 || freshContentPresent)) {
        hadRefusal = true;
        log(`${logPrefix} -- refused full update_readme rewrite (empty body while the project or today's log has real content); left unchanged.`);
        return "Error: refused -- an empty body was returned while the project (or today's log) has real content. README left unchanged.";
      }

      const ok = await commitReadmeContent(withReadmeBody(currentReadmeContent, newBody));
      if (!ok) return "Error: failed to save README rewrite";
      readmeEditSummaries.push(`rewrote the full README (${reason})`);
      log(`${logPrefix} -- full README rewrite: ${reason}`);
      return "README rewritten.";
    },
  };

  return {
    executors,
    organizeActions,
    readmeEditSummaries,
    hadRefusal: () => hadRefusal,
    hadIncompleteAttempt: () =>
      readmeWholeChunks.length > 0 ||
      [...sectionChunks.values()].some((buffered) => buffered.length > 0) ||
      [...fileChunks.values()].some((buffered) => buffered.length > 0),
    getCurrentReadme: () => ({ content: currentReadmeContent, fileId: currentReadmeFileId }),
  };
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
  /** This entry's own current `_meta.md` -- used ONLY to record
   * `capturedNoOpSourceHash` when today's run concludes with a genuine
   * no-op (see that field's own doc, `projectN01.server.ts`), never read
   * for anything else here (the caller already used its `sourceHash` to
   * decide whether to call this function at all). */
  entryMeta: DailyLogEntryMeta;
  filed: FiledAttachment[];
  sourceRef: string;
  llm: LlmProvider;
  skillContent: string;
  generalSkill: string | null;
  extraSkillFiles: { name: string; content: string }[];
  /** True once `runCapture` has already made at least one other REAL
   * (non-skipped) `captureOneDay` call earlier in this same run -- see
   * `runCapture`'s own `realCaptureCallsSoFar` and `llmProvider.ts`'s
   * doc on why this can't be inferred locally (or from a raw entry
   * count, which only grows over time). */
  cacheSystemPrompt: boolean;
  log: (line: string) => void;
}): Promise<{
  readmeUpdated: boolean;
  organizeActions: string[];
  /** Set when the model called request_reorganize because TODAY's own
   * log explicitly asked for the project's structure to be reconsidered
   * -- `runCapture` acts on this by running `runReorganize` right after
   * this day's own edits, still within the same capture cycle. */
  reorganizeRequested: { reason: string } | null;
}> {
  const { actingHumanId, projectFolder, date, entryFolder, entryMeta, filed, sourceRef, llm, skillContent, generalSkill, extraSkillFiles, cacheSystemPrompt, log } = input;

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

  const freshContentPresent = cardContent.trim().length > 0 || summaries.some((s) => s.body.trim().length > 0);
  const {
    executors: readmeExecutors,
    organizeActions,
    readmeEditSummaries,
    hadRefusal,
    hadIncompleteAttempt,
    getCurrentReadme,
  } = createReadmeAndFileExecutors({
    projectFolder,
    log,
    logPrefix: `capture: ${date}`,
    initialReadmeContent: readmeContent,
    initialReadmeFileId: readme?._id,
    freshContentPresent,
  });

  let reorganizeRequested: { reason: string } | null = null;
  const executors: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    ...readmeExecutors,
    request_reorganize: async (input) => {
      const reason = String(input.reason ?? "").trim() || "(no reason given)";
      reorganizeRequested = { reason };
      log(`capture: ${date} -- today's log requested a reorganization: ${reason}`);
      return "Noted -- a dedicated reorganization pass will run after today's edits.";
    },
  };

  const userPrompt = buildUserPrompt({ tree, cardContent, filed, summaries, readmeContent });
  const { usage, durationMs, model, finalText, truncated, truncationRetries, hitMaxTurns } = await runAgentLoop(
    llm,
    buildSystemPrompt(skillContent, generalSkill, extraSkillFiles),
    userPrompt,
    [CREATE_FOLDER_TOOL, MOVE_FILE_TOOL, WRITE_FILE_TOOL, UPDATE_SECTION_TOOL, REMOVE_SECTION_TOOL, UPDATE_README_TOOL, REQUEST_REORGANIZE_TOOL],
    executors,
    // Higher than runAgentLoop's own default (6): chunked README/file
    // writes (see CHUNK_PROTOCOL_NOTE) can take several turns on their
    // own on a big update, on top of any create_folder/move_file calls.
    16,
    cacheSystemPrompt,
  );

  if (truncationRetries > 0 && !truncated) {
    log(
      `capture: ${date} -- the model hit its own output token limit ${truncationRetries} time${truncationRetries > 1 ? "s" : ""} but recovered after being asked to use smaller chunks; continuing normally.`,
    );
  }
  if (truncated) {
    log(
      `capture: ${date} -- the model's generation was cut off by its own output token limit before it finished${truncationRetries > 0 ? ` (even after ${truncationRetries} retr${truncationRetries > 1 ? "ies" : "y"} with smaller chunks)` : ""}; whatever it had already done this run stands, but its last, incomplete action was discarded. Re-run capture to pick up where it left off.`,
    );
  }
  if (hitMaxTurns) {
    log(
      `capture: ${date} -- hit this run's own turn limit while the model still had more queued up; whatever it had already done stands, but it may not have finished. Re-run capture to pick up where it left off.`,
    );
  }

  // Surfaced on /fruits/maker's "Errors" count -- a refusal, an
  // incomplete attempt, or a run that hit its own turn/token bounds is a
  // real signal something needs attention (a project outgrowing its
  // budget, a skill file provoking runaway generation), not a quiet
  // no-op day. Never a thrown exception (see runCapture's own try/catch
  // for those), so without this the dashboard would have no way to
  // distinguish this from a normal day.
  const incomplete = truncated || hitMaxTurns || hadRefusal() || hadIncompleteAttempt();
  await recordPhylogUsage({
    humanId: actingHumanId,
    projectFolderId: projectFolder._id,
    stage: "capture",
    kind: "organize",
    model: model ?? undefined,
    usage,
    durationMs,
    outcome: incomplete ? "error" : "success",
    errorKind: incomplete ? "incomplete" : undefined,
  });

  // Every README-mutating tool already committed its own change (or
  // didn't) DURING the loop above -- the factory's own current-readme
  // state reflects the cumulative result of everything that succeeded. A
  // single before/after changeset for the whole day reads better in the
  // Release Log than one entry per section touched.
  const { content: finalReadmeContent, fileId: finalReadmeFileId } = getCurrentReadme();
  const readmeUpdated = finalReadmeContent !== readmeContent;
  if (readmeUpdated && finalReadmeFileId) {
    const actionSummary = organizeActions.length > 0 ? ` (also: ${organizeActions.join(", ")})` : "";
    await createReleaseLogEntry({
      projectFolderId: projectFolder._id,
      date,
      actingHumanId,
      kind: "ai-update",
      summary: `PhyLog captured the day -- [View](/fruits/vault?file=${finalReadmeFileId}): ${readmeEditSummaries.join(", ")}${actionSummary}`,
      sourceRef,
      changesets: [
        { fileId: finalReadmeFileId, action: "content-edit", before: { content: readmeContent }, after: { content: finalReadmeContent } },
      ],
    });
    log(`capture: ${date} -- README updated: ${readmeEditSummaries.join(", ")}`);
  } else if (organizeActions.length > 0) {
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
  } else if (!truncated && !hitMaxTurns && !hadRefusal() && !hadIncompleteAttempt()) {
    // Nothing changed at all -- without this, "why didn't my README
    // update" is undiagnosable, since the model's own reasoning for
    // abstaining is otherwise thrown away. Log it verbatim.
    if (!reorganizeRequested) {
      log(
        finalText
          ? `capture: ${date} -- no README update or reorganization; model said: ${finalText}`
          : `capture: ${date} -- no README update or reorganization (model gave no reasoning text).`,
      );
    }

    // A CLEAN no-op -- no truncation, no refusal, no incomplete chunk
    // attempt, just a genuine "nothing needed to change" for this exact
    // content. Record it so this entry doesn't get a fresh, wasted LLM
    // call on every single future run forever (a real, confirmed bug --
    // a quiet day was previously never recorded anywhere, since only a
    // REAL change gets a Release Log entry). Deliberately excludes the
    // truncated/hitMaxTurns/refusal/incomplete cases above, which should
    // keep retrying instead of being memorized as "nothing to do here."
    //
    // Also excludes the case where THIS day's own log asked for a
    // reorganization (`reorganizeRequested`): `runCapture` runs that pass
    // right after this function returns, separately from this entry's own
    // Release Log bookkeeping. Marking this entry reviewed here, before
    // that pass has even run, would mean a truncated/incomplete
    // reorganization attempt could never be retried on a later run (this
    // entry would already look "done" and get skipped outright). Instead,
    // `runCapture` itself writes this same marker for the triggering entry,
    // but only once the reorganize pass it kicks off has been confirmed to
    // finish cleanly.
    if (!reorganizeRequested) {
      await writeDailyLogEntryMeta(entryFolder, { ...entryMeta, capturedNoOpSourceHash: entryMeta.sourceHash });
    }
  }

  return { readmeUpdated, organizeActions, reorganizeRequested };
}

function buildReorganizeSystemPrompt(
  skillContent: string,
  generalSkill: string | null,
  extraSkillFiles: { name: string; content: string }[],
  reason: string | null,
): string {
  const generalSection = generalSkill ? `\n\n## Project SKILL.md (general steering)\n\n${generalSkill}` : "";
  const extraSection = extraSkillFiles.length > 0
    ? `\n\n## Other reference files in this project's skills/ folder\n\n${extraSkillFiles.map((f) => `### ${f.name}\n\n${f.content}`).join("\n\n")}`
    : "";
  const trigger = reason
    ? `This pass was triggered because a daily log explicitly asked for it: "${reason}"`
    : "This pass was triggered manually.";
  return `You are PhyLog, running a DEDICATED reorganization pass for one project -- separate from the normal day-by-day capture loop, which only ever sees one day's log plus the current README and never gets a moment to step back and evaluate the whole structure. You are being given the ENTIRE current README specifically so you can do that now.

${trigger}

Your job: read the whole README, decide whether its current structure (section boundaries, and what's inlined versus already split into its own file) still serves the project well, and make the changes needed -- freely use create_folder / move_file / write_file / update_section / remove_section / update_readme. Restructuring IS the point of this pass, not a rare exception -- don't hold back the way a normal day's pass would. If the structure genuinely already serves the project well, it's fine to make no changes at all -- say so, don't restructure for its own sake.

Never invent, remove, or alter the SUBSTANCE of anything. Move, split, merge, and re-file freely, but every fact, quote, number, and attribution that already exists in the README must survive exactly as it already reads. This pass is about WHERE things live and how they're organized, never about rewriting what they say.

${DIRECTIVE_GUIDE}

## Project CAPTURE.md

${skillContent}${generalSection}${extraSection}`;
}

function buildReorganizeUserPrompt(input: { tree: string; readmeContent: string }): string {
  return [
    `## Current project tree\n\n${input.tree || "(empty)"}`,
    `## Current README.md (full)\n\n${input.readmeContent || "(empty)"}`,
  ].join("\n\n---\n\n");
}

export type ReorganizeResult =
  | { ok: true; changed: boolean; summary: string[]; incomplete: boolean }
  | { ok: false; error: string };

/**
 * A dedicated, whole-README structure pass -- distinct from
 * `captureOneDay`'s narrow, one-day-at-a-time loop. Given the ENTIRE
 * current README (not one day's log), explicitly asked to evaluate and
 * fix the project's overall structure. Two ways to reach this:
 *
 *   - Automatically, from `runCapture`'s own loop, when a day's log
 *     explicitly asks for it (`request_reorganize`, `captureOneDay`).
 *   - On demand, via `nopal phylog reorganize` / `POST /api/phylog/reorganize`
 *     (see the `phylog` skill), for a human who wants to trigger this
 *     without waiting for (or writing) a daily-log request.
 *
 * Reuses `createReadmeAndFileExecutors` -- the EXACT same safety nets
 * (chunk buffering, the empty-content refusal, immediate-commit) as the
 * daily pass, just with `freshContentPresent: false` (no "today" to
 * justify refusing an empty target against -- only the target's own
 * current content matters here).
 */
export async function runReorganize(
  actingHumanId: string,
  projectFolder: VaultFolder,
  opts: { llm?: LlmProvider; reason?: string; date?: string; sourceRef?: string },
  onProgress?: (line: string) => void,
): Promise<ReorganizeResult> {
  const log = onProgress ?? (() => {});
  if (!opts.llm && !isPhylogAgentConfigured()) {
    return { ok: false, error: "PhyLog's agent is not configured (no ANTHROPIC_API_KEY set)." };
  }

  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  const readmeContent = readme?.content ?? "";
  const tree = await renderManagedTree(projectFolder.human_id, projectFolder._id);
  const skillContent = (await getProjectStageSkill(projectFolder, "CAPTURE.md")) ?? (await getEffectiveDefaultSkill("capture"));
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const llm = opts.llm ?? new AnthropicProvider();
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const sourceRef = opts.sourceRef ?? `reorganize:${projectFolder._id}:${Date.now()}`;

  log(`reorganize: reviewing "${projectFolder.name}"'s current structure...`);

  const {
    executors,
    organizeActions,
    readmeEditSummaries,
    hadRefusal,
    hadIncompleteAttempt,
    getCurrentReadme,
  } = createReadmeAndFileExecutors({
    projectFolder,
    log,
    logPrefix: "reorganize",
    initialReadmeContent: readmeContent,
    initialReadmeFileId: readme?._id,
    freshContentPresent: false,
  });

  const userPrompt = buildReorganizeUserPrompt({ tree, readmeContent });
  const { usage, durationMs, model, finalText, truncated, truncationRetries, hitMaxTurns } = await runAgentLoop(
    llm,
    buildReorganizeSystemPrompt(skillContent, generalSkill, extraSkillFiles, opts.reason ?? null),
    userPrompt,
    [CREATE_FOLDER_TOOL, MOVE_FILE_TOOL, WRITE_FILE_TOOL, UPDATE_SECTION_TOOL, REMOVE_SECTION_TOOL, UPDATE_README_TOOL],
    executors,
    // Higher than the daily pass's own 16 -- a real whole-project
    // restructure can touch many sections/files in one pass.
    24,
    false,
  );

  if (truncationRetries > 0 && !truncated) {
    log(
      `reorganize: the model hit its own output token limit ${truncationRetries} time${truncationRetries > 1 ? "s" : ""} but recovered after being asked to use smaller chunks; continuing normally.`,
    );
  }
  if (truncated) {
    log(
      `reorganize: the model's generation was cut off by its own output token limit before it finished${truncationRetries > 0 ? ` (even after ${truncationRetries} retr${truncationRetries > 1 ? "ies" : "y"} with smaller chunks)` : ""}; whatever it had already done stands, but its last, incomplete action was discarded. Re-run to pick up where it left off.`,
    );
  }
  if (hitMaxTurns) {
    log(
      "reorganize: hit this run's own turn limit while the model still had more queued up; whatever it had already done stands, but it may not have finished. Re-run to pick up where it left off.",
    );
  }

  const incomplete = truncated || hitMaxTurns || hadRefusal() || hadIncompleteAttempt();
  await recordPhylogUsage({
    humanId: actingHumanId,
    projectFolderId: projectFolder._id,
    stage: "capture",
    kind: "organize",
    model: model ?? undefined,
    usage,
    durationMs,
    outcome: incomplete ? "error" : "success",
    errorKind: incomplete ? "incomplete" : undefined,
  });

  const { content: finalReadmeContent, fileId: finalReadmeFileId } = getCurrentReadme();
  const readmeChanged = finalReadmeContent !== readmeContent;
  if (readmeChanged && finalReadmeFileId) {
    const actionSummary = organizeActions.length > 0 ? ` (also: ${organizeActions.join(", ")})` : "";
    await createReleaseLogEntry({
      projectFolderId: projectFolder._id,
      date,
      actingHumanId,
      kind: "ai-update",
      summary: `PhyLog reorganized this project's structure -- [View](/fruits/vault?file=${finalReadmeFileId}): ${readmeEditSummaries.join(", ")}${actionSummary}`,
      sourceRef,
      changesets: [
        { fileId: finalReadmeFileId, action: "content-edit", before: { content: readmeContent }, after: { content: finalReadmeContent } },
      ],
    });
    log(`reorganize: README restructured: ${readmeEditSummaries.join(", ")}`);
  } else if (organizeActions.length > 0) {
    await createReleaseLogEntry({
      projectFolderId: projectFolder._id,
      date,
      actingHumanId,
      kind: "ai-update",
      summary: `PhyLog reorganized this project: ${organizeActions.join(", ")}`,
      sourceRef,
    });
    log(`reorganize: ${organizeActions.join(", ")}`);
  } else if (!hadRefusal() && !hadIncompleteAttempt()) {
    log(
      finalText
        ? `reorganize: no changes made; model said: ${finalText}`
        : "reorganize: no changes made (model gave no reasoning text).",
    );
  }

  return {
    ok: true,
    changed: readmeChanged || organizeActions.length > 0,
    summary: [...readmeEditSummaries, ...organizeActions],
    incomplete,
  };
}
