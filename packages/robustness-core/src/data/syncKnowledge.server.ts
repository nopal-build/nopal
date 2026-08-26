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
 * Walks every file under a project's `syncs/` tree (any connector folder,
 * not just `Daily Logs` — see the `vault` skill's Sync types section) and
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
import { getProjectStageSkill, isSkipInstruction, listExtraSkillFiles } from "./projectN02.server";
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

function buildKnowledgeContent(input: { sourceFileId: string; hash: string; body: string }): string {
  const frontmatter = stringifyYaml({
    source: input.sourceFileId,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body}`;
}

/** Walks a project's `syncs/` tree recursively, collecting every real
 * file — skipping `_knowledge` folders entirely (see this module's own
 * header on why). */
async function collectSyncCandidates(
  humanId: string,
  folderId: string,
): Promise<SyncKnowledgeCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: SyncKnowledgeCandidate[] = files.map((f) => ({ fileId: f._id, name: f.name }));
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
    return { ok: true, skipped: true, entries: [], unsupported: [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) {
    log("sync-knowledge: no syncs/ folder yet — nothing to do.");
    return { ok: true, skipped: false, entries: [], unsupported: [] };
  }

  const candidates = await collectSyncCandidates(projectFolder.human_id, syncsFolder._id);
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");

  let photoLlm: PhotoDescriber | undefined = opts.photoDescriber;
  let textLlm: LlmProvider | undefined = opts.provider;
  // Counts REAL `textLlm.complete()` calls only — same reasoning as
  // `preCapture.server.ts`'s own `realTextSummaryCallsSoFar`.
  let realTextCallsSoFar = 0;

  const entries: SyncKnowledgeEntry[] = [];
  const unsupported: { fileId: string; name: string }[] = [];

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
      entries.push({ fileId: source._id, name: source.name, knowledgeFileId: existing._id, generated: false });
      continue;
    }

    let body: string | null = null;
    const isImage = isImageContentType(source.content_type) && !!source.s3_key;
    const kind = isImage ? "photo-knowledge" : "text-knowledge";
    const callStart = Date.now();
    try {
      if (isImage) {
        photoLlm ??= new AnthropicProvider();
        const bytes = await perf.time("sync-knowledge", "api", "downloadFileBytes", { fileId: source._id }, () =>
          downloadFileBytes(source.s3_key!),
        );
        const result = await photoLlm.describePhoto({
          imageBase64: bytes.toString("base64"),
          mediaType: source.content_type,
          context: `Knowledge-extraction instructions for this project:\n\n${skillContent}`,
        });
        body = result.description;
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
          name: "describePhoto",
          params: { fileId: source._id, name: source.name },
          durationMs,
        });
      } else if (source.content) {
        textLlm ??= new AnthropicProvider();
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

    const content = buildKnowledgeContent({ sourceFileId: source._id, hash, body });
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
    if (!knowledgeFileId) continue;

    log(`sync-knowledge: wrote "${name}" for "${source.name}".`);
    entries.push({ fileId: source._id, name: source.name, knowledgeFileId, generated: true });
  }

  return { ok: true, skipped: false, entries, unsupported };
}
