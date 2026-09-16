/**
 * GraphLog's `sync-knowledge` stage — the first AGENTIC stage in the
 * pipeline (see the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge (this file) -> sync-graph
 *     -> graph-project-view
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * PhyLog's own pre-capture (`preCapture.server.ts`): a project's
 * `skills/KNOWLEDGE.md` (seeded with a "skip" default — see
 * `graphLogDefaults.server.ts`) is the ONLY thing that decides whether
 * this does anything at all. When it's "skip", no files are examined, no
 * model is ever called.
 *
 * Walks every ATTACHMENT under a project's `syncs/` tree (any connector
 * folder, not just `Daily Logs` — see the `vault` skill's Sync types
 * section; never the synced Cards themselves, see `collectSyncCandidates`) and
 * asks an LLM, grounded in `KNOWLEDGE.md`'s own instructions, to pull out
 * concrete, extractable METADATA about it — names, dates, decisions — into
 * a sidecar `<name>.knowledge.md`. Deliberately NOT a narrative summary of
 * the file's prose (that's `sync-graph`'s job, one stage later, reading
 * these sidecars alongside the source itself).
 *
 * `_knowledge/` is a RESERVED folder name, one per source folder (never
 * nested deeper) — e.g. `syncs/Daily Logs/2026-08-17-h123.md`'s knowledge
 * file lands at `syncs/Daily Logs/_knowledge/2026-08-17-h123.knowledge.md`.
 * Lazily created the first time there's actually something to write into
 * it, same "create on first real write" convention `ensureProjectGraphFolder`/
 * `ensureProjectDailyLogsFolder` use for their own system-managed folders.
 * Never recursed INTO as a source of candidates itself — its own contents
 * are OUTPUT, never input, so a re-run never tries to extract knowledge
 * ABOUT a knowledge file.
 *
 * IDEMPOTENT against a hash of the source file's own bytes/content
 * (`content_hash`, falling back to `s3_key`/id) — stored in the knowledge
 * file's own front matter (`sourceHash`) and re-derived fresh on each
 * call, same convention pre-capture already established. An unchanged
 * source file is a total no-op.
 *
 * Image -> vision call (`PhotoDescriber.describePhoto`). Text file ->
 * plain extraction call (`LlmProvider.complete`, no tools). Anything else
 * (binary, no extracted text) -> left unsupported. Same provider seam
 * PhyLog uses (`llmProvider.ts`/`anthropicProvider.server.ts`) — no new
 * LLM infra needed.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter } from "./project.types";
import { isImageContentType } from "./sorter.server";
import {
  createFileRef,
  createVaultFolder,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { downloadFileBytes } from "./file.server";
import { parseSyncedCardFileName } from "./dailyLogSync.server";
import { formatSeconds, isVideoContentType, normalizeImageForVision, videoToStills } from "./attachmentFrames.server";
import type { GraphLogEventKind } from "./graphLogMetrics.server";
import type { PhotoDescriptionResult } from "./llmProvider";
import {
  classifyStageSkill,
  composeStageSkill,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
  readSkillFingerprint,
} from "./projectN02.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";
import type { LlmProvider, PhotoDescriber } from "./llmProvider";

/** The reserved subfolder name every `syncs/` folder may carry — see this
 * module's own header. Shared here (not `dailyLogSync.server.ts`, which
 * has no reason to know this name) since only sync-knowledge ever reads
 * or writes into one. */
export const KNOWLEDGE_FOLDER_NAME = "_knowledge";

export type SyncKnowledgeCandidate = { fileId: string; name: string };

export type SyncKnowledgeEntry = {
  fileId: string;
  name: string;
  knowledgeFileId: string;
  /** True when a fresh knowledge file was generated THIS call; false when
   * an already-up-to-date one was found and reused untouched. */
  generated: boolean;
};

export type SyncKnowledgeResult =
  | {
      ok: true;
      /** True when `skills/KNOWLEDGE.md` is missing or says "skip" — a
       * total no-op, no files examined, no model called. */
      skipped: boolean;
      entries: SyncKnowledgeEntry[];
      /** Candidates that couldn't be processed (no readable text, not an
       * image) — reported so a human can see what's being silently left
       * behind, not just "nothing happened". */
      unsupported: { fileId: string; name: string }[];
      /** Sidecars that are up to date by content but were written under
       * an older KNOWLEDGE.md than the current one. Reported, never acted
       * on by this stage (see `composeStageSkill`). Absent on the
       * early-return paths. */
      staleSidecars?: number;
      /** Reasons this stage finished without doing everything it set out
       * to, in the same shape every other stage uses, so the pipeline can
       * aggregate them and the run says so.
       *
       * This stage had no way to report ANYTHING until now, and it is the
       * one that describes photos. A project whose `KNOWLEDGE.md` was
       * never seeded skipped it in 201ms and the run said OK, so an
       * uncaptioned photo had neither a caption nor a description, never
       * earned a node, and never reached the README. Nothing about that
       * was visible anywhere. */
      incomplete: string[];
    }
  | { ok: false; error: string };

function sourceHash(basis: string): string {
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
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

/** `IMG_1523.jpeg` -> `IMG_1523.knowledge.md` — the sidecar filename
 * `sync-graph` looks for alongside a source file's own name, one level
 * down in `_knowledge/`. Mirrors `sorter.server.ts`'s `summaryFileName`
 * shape, different suffix (never confusable with a PhyLog `-summary.md`,
 * which also lives right next to its source rather than in a reserved
 * subfolder). */
function knowledgeFileName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}.knowledge.md`;
}

function buildKnowledgeContent(input: {
  sourceFileId: string;
  hash: string;
  body: string;
  extraMeta?: Record<string, unknown>;
}): string {
  const frontmatter = stringifyYaml({
    source: input.sourceFileId,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
    ...(input.extraMeta ?? {}),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body}`;
}

/** Walks a project's `syncs/` tree recursively, collecting every real
 * file — skipping `_knowledge` folders entirely (see this module's own
 * header on why), and skipping the synced daily-log CARDS themselves.
 *
 * ATTACHMENTS ONLY, by design. A Card is a person's own words, and
 * `sync-graph` reads it verbatim one stage later (ADR-001, ADR-012); a
 * model's "extracted metadata" about it is a second reading of the same
 * text that sync-graph does not need, costs a call per Card per change,
 * and is exactly the summary-of-a-summary shape ADR-006 and ADR-010 were
 * written against. What this stage exists for is the file a Card cannot
 * speak for: a photo, a video frame, a text attachment -- the thing that
 * has no path into the graph until something describes it. A file whose
 * name matches neither shape (a future non-daily-log sync source) is
 * still a candidate: it is not a Card. */
async function collectSyncCandidates(
  humanId: string,
  folderId: string,
): Promise<SyncKnowledgeCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: SyncKnowledgeCandidate[] = files
    .filter((f) => !parseSyncedCardFileName(f.name))
    .map((f) => ({ fileId: f._id, name: f.name }));
  for (const sub of folders) {
    if (sub.name === KNOWLEDGE_FOLDER_NAME) continue;
    out.push(...(await collectSyncCandidates(humanId, sub._id)));
  }
  return out;
}

async function ensureKnowledgeFolder(humanId: string, parentFolderId: string): Promise<VaultFolder> {
  const { folders } = await listFolderChildren(humanId, parentFolderId);
  const existing = folders.find((f) => f.name === KNOWLEDGE_FOLDER_NAME);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: humanId,
    name: KNOWLEDGE_FOLDER_NAME,
    parent_folder_id: parentFolderId,
  });
  if (!created) throw new Error("Failed to create a _knowledge folder");
  return created;
}

export interface RunSyncKnowledgeOptions {
  provider?: LlmProvider;
  photoDescriber?: PhotoDescriber;
  log?: (line: string) => void;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. */
  perf?: GraphLogPerfRecorder;
}

/**
 * Runs sync-knowledge for one project. Sweeps every file currently under
 * `syncs/` (at any depth) that doesn't already have an up-to-date sidecar
 * in its own `_knowledge/` folder — idempotency makes a repeat call cheap,
 * only genuinely new/changed files ever call the model.
 */
export async function runSyncKnowledge(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunSyncKnowledgeOptions = {},
): Promise<SyncKnowledgeResult> {
  const log = opts.log ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const skill = await getProjectStageSkill(projectFolder, "KNOWLEDGE.md");
  if (isSkipInstruction(skill)) {
    // An explicit `skip` is a decision and stays quiet. A never-seeded
    // file is a broken project that silently loses every uncaptioned
    // photo, and says so. Same split as the other stages.
    const missing = classifyStageSkill(skill) === "missing";
    const reason = "skills/KNOWLEDGE.md is missing or empty, so no file was read and no photo was described";
    if (missing) log(`sync-knowledge: ${reason}.`);
    return { ok: true, skipped: true, entries: [], unsupported: [], incomplete: missing ? [reason] : [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) {
    log("sync-knowledge: no syncs/ folder yet — nothing to do.");
    return { ok: true, skipped: false, entries: [], unsupported: [], incomplete: [] };
  }

  const candidates = await collectSyncCandidates(projectFolder.human_id, syncsFolder._id);
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const { content: skillContent, fingerprint: skillFingerprint } = composeStageSkill(skill, generalSkill, extraSkillFiles);

  let photoLlm: PhotoDescriber | undefined = opts.photoDescriber;
  let textLlm: LlmProvider | undefined = opts.provider;
  // Counts REAL `textLlm.complete()` calls only — same reasoning as
  // `preCapture.server.ts`'s own `realTextSummaryCallsSoFar`.
  let realTextCallsSoFar = 0;

  const entries: SyncKnowledgeEntry[] = [];
  const unsupported: { fileId: string; name: string }[] = [];
  let staleSidecars = 0;

  for (const candidate of candidates) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per file, so a Stop request never
    // waits longer than the current file's own extraction call.
    await throwIfGraphLogCancelled(projectFolder._id);

    const source = await getFileRefById(candidate.fileId);
    if (!source || !source.folder_id) {
      log(`sync-knowledge: candidate "${candidate.name}" (${candidate.fileId}) no longer resolves — skipped.`);
      continue;
    }

    const hash = sourceHash(source.content_hash ?? source.s3_key ?? source._id);
    const knowledgeFolder = await ensureKnowledgeFolder(source.human_id, source.folder_id);
    const { files: knowledgeFiles } = await listFolderChildren(source.human_id, knowledgeFolder._id);
    const name = knowledgeFileName(source.name);
    const existingListing = knowledgeFiles.find((f) => f.name === name);
    const existing = existingListing ? await getFileRefById(existingListing._id) : undefined;

    if (existing && existingSourceHash(existing.content) === hash) {
      // Up to date by content; may still be under an older KNOWLEDGE.md.
      // Counted and reported, never re-run on that basis alone (see
      // `composeStageSkill`).
      if (readSkillFingerprint(existing.content) !== skillFingerprint) staleSidecars += 1;
      entries.push({ fileId: source._id, name: source.name, knowledgeFileId: existing._id, generated: false });
      continue;
    }

    let body: string | null = null;
    /** Extra front-matter lines for a sidecar built from stills rather
     * than the file itself -- see `attachmentFrames.server.ts`. */
    let extraMeta: Record<string, unknown> = {};
    const isImage = isImageContentType(source.content_type) && !!source.s3_key;
    const isVideo = isVideoContentType(source.content_type) && !!source.s3_key;
    const kind: GraphLogEventKind = isVideo ? "video-knowledge" : isImage ? "photo-knowledge" : "text-knowledge";
    const callStart = Date.now();
    try {
      if (isImage || isVideo) {
        photoLlm ??= AnthropicProvider.forStage("sync-knowledge");
        const bytes = await perf.time("sync-knowledge", "api", "downloadFileBytes", { fileId: source._id }, () =>
          downloadFileBytes(source.s3_key!),
        );
        const context = `Knowledge-extraction instructions for this project:\n\n${skillContent}`;
        let result: PhotoDescriptionResult;
        if (isVideo) {
          // A video is a few stills, described as a sequence. Frames only:
          // narration is not heard, and the sidecar says so in its own
          // front matter and first line, the way a description-grounded
          // node says what it is.
          const extension = source.name.split(".").pop() ?? "bin";
          const { stills, durationSeconds } = await perf.time(
            "sync-knowledge",
            "fn",
            "videoToStills",
            { fileId: source._id, name: source.name },
            () => videoToStills(bytes, extension),
          );
          const at = stills.map((f) => formatSeconds(f.atSeconds ?? 0));
          result = await photoLlm.describeImages({
            images: stills.map((f, i) => ({
              imageBase64: f.jpegBase64,
              mediaType: "image/jpeg",
              label: `Frame ${i + 1} of ${stills.length}, ${at[i]} into the clip:`,
            })),
            context,
            framing:
              `You are describing a VIDEO attached to a project's daily-log Card, from ${stills.length} still frames taken in order across its ${formatSeconds(durationSeconds)} length. ` +
              `Write one short, factual paragraph (3-5 sentences) capturing what the clip shows and what changes across the frames -- objects, people, setting, visible state of progress -- grounded ONLY in what is visible in the frames plus the text context you are given. ` +
              `You cannot hear it: never describe sound, speech, or narration. Never speculate beyond what is visible. No preamble, no "the video shows" framing -- just the description itself.`,
          });
          extraMeta = { describedFrom: "video-frames", frames: stills.length, frameTimes: at, durationSeconds: Math.round(durationSeconds) };
          body = `*Described from ${stills.length} still frames of a ${formatSeconds(durationSeconds)} video (at ${at.join(", ")}); no audio was heard.*\n\n${result.description}`;
        } else {
          // HEIC, and any other image format the model does not take, is
          // turned into a JPEG first; a plain JPEG/PNG goes through as-is.
          const image = await normalizeImageForVision(bytes, source.content_type);
          result = await photoLlm.describePhoto({ imageBase64: image.base64, mediaType: image.mediaType, context });
          body = result.description;
        }
        const durationMs = Date.now() - callStart;
        await recordGraphLogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "sync-knowledge",
          kind,
          model: result.model,
          usage: result.usage,
          durationMs,
          outcome: "success",
        });
        await perf.event({
          process: "sync-knowledge",
          type: "llm",
          name: isVideo ? "describeVideoFrames" : "describePhoto",
          params: { fileId: source._id, name: source.name, ...extraMeta },
          durationMs,
        });
      } else if (source.content) {
        textLlm ??= AnthropicProvider.forStage("sync-knowledge");
        const cacheSystemPrompt = realTextCallsSoFar > 0;
        realTextCallsSoFar++;
        const response = await textLlm.complete({
          system: `You are GraphLog's sync-knowledge step, extracting concrete metadata from a file per a project owner's own instructions — names, dates, decisions, not a narrative summary. Follow those instructions closely; write only the extracted metadata itself, no preamble.\n\n${skillContent}`,
          messages: [
            {
              role: "user",
              content: `File name: ${source.name}\n\nFile content:\n\n${source.content}`,
            },
          ],
          tools: [],
          cacheSystemPrompt,
        });
        if (response.stopReason === "max_tokens") {
          // Same class of safety net as `preCapture.server.ts`'s own text
          // path — never persist a fragment cut off by the model's own
          // output limit as if it were finished.
          log(`sync-knowledge: "${source.name}"'s output was cut off by the model's own output limit — skipped, will retry next run.`);
          const durationMs = Date.now() - callStart;
          await recordGraphLogUsage({
            humanId: actingHumanId,
            projectFolderId: projectFolder._id,
            stage: "sync-knowledge",
            kind,
            model: response.model,
            usage: response.usage,
            durationMs,
            outcome: "error",
            errorKind: "incomplete",
          });
          await perf.event({
            process: "sync-knowledge",
            type: "llm",
            name: "complete",
            // The truncated fragment itself, never persisted anywhere
            // else (the knowledge file only gets written on success) --
            // exactly the case where seeing what the model was in the
            // middle of writing actually matters.
            params: {
              fileId: source._id,
              name: source.name,
              text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
            },
            durationMs,
            outcome: "error",
          });
          unsupported.push({ fileId: source._id, name: source.name });
          continue;
        }
        body = response.text?.trim() || null;
        const durationMs = Date.now() - callStart;
        await recordGraphLogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "sync-knowledge",
          kind,
          model: response.model,
          usage: response.usage,
          durationMs,
          outcome: "success",
        });
        await perf.event({
          process: "sync-knowledge",
          type: "llm",
          name: "complete",
          // Redundant with the knowledge file itself on success (`body`
          // above), but kept for consistency with every other LLM event
          // in this timeline — same field, same place, every time.
          params: { fileId: source._id, name: source.name, text: body ? body.slice(0, 8000) : null },
          durationMs,
        });
      } else {
        unsupported.push({ fileId: source._id, name: source.name });
        log(`sync-knowledge: "${source.name}" has no readable content — skipped (no knowledge file written).`);
        continue;
      }
    } catch (err) {
      // One bad/oversized file must never abort the rest of the batch.
      unsupported.push({ fileId: source._id, name: source.name });
      log(
        `sync-knowledge: "${source.name}" couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`,
      );
      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-knowledge",
        kind,
        durationMs,
        outcome: "error",
        errorKind: classifyGraphLogError(err),
      });
      await perf.event({
        process: "sync-knowledge",
        type: "llm",
        name: isImage ? "describePhoto" : "complete",
        params: { fileId: source._id, name: source.name },
        durationMs,
        outcome: "error",
      });
      continue;
    }

    if (!body) {
      unsupported.push({ fileId: source._id, name: source.name });
      continue;
    }

    const content = buildKnowledgeContent({ sourceFileId: source._id, hash, body, extraMeta: { ...extraMeta, skillFingerprint } });
    const knowledgeFileId = existing
      ? (await updateFileRef(existing._id, { content }))?._id
      : (
          await createFileRef({
            human_id: source.human_id,
            name,
            content,
            content_type: "text/markdown",
            folder_id: knowledgeFolder._id,
          })
        )?._id;
    if (!knowledgeFileId) {
      // The vision/extraction call was already made and already recorded
      // as a success in usage metrics; the write is what failed. This was
      // a bare `continue`: no log, not in `unsupported`, not in
      // `incomplete`, so the dashboard showed a paid, successful
      // description that produced no file. It is exactly what
      // `unsupported` is for -- a file that reached this stage and has no
      // path into the graph -- so it goes there and rides the existing
      // `incomplete` line below.
      log(`sync-knowledge: could not write "${name}" for "${source.name}" after describing it; will retry next run.`);
      unsupported.push({ fileId: source._id, name: source.name });
      continue;
    }

    log(`sync-knowledge: wrote "${name}" for "${source.name}".`);
    entries.push({ fileId: source._id, name: source.name, knowledgeFileId, generated: true });
  }

  // `unsupported` has always been collected "so a human can see what's
  // being silently left behind" (see its own doc above) and has never had
  // a reader. A file that reached this stage and produced nothing is a
  // file that cannot reach the graph or the README, so it is exactly a
  // reason the run did not do everything it set out to.
  const incomplete: string[] =
    unsupported.length > 0
      ? [
          `${unsupported.length} file(s) could not be read or described, so nothing about them can reach the graph: ` +
            unsupported.slice(0, 5).map((u) => u.name).join(", ") +
            (unsupported.length > 5 ? `, and ${unsupported.length - 5} more` : ""),
        ]
      : [];
  if (staleSidecars > 0) {
    log(`sync-knowledge: ${staleSidecars} sidecar(s) were written under an older KNOWLEDGE.md and were left as they are (reset-knowledge rewrites them).`);
  }
  return { ok: true, skipped: false, entries, unsupported, incomplete, staleSidecars };
}
