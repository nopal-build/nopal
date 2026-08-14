/**
 * PhyLog's pre-capture stage — the FIRST stage of the pipeline (see the
 * `phylog` skill for the full picture):
 *
 *   pre-capture (this file) -> capture (`capture.server.ts`)
 *     -> post-capture (`postCapture.server.ts`)
 *
 * Entirely SKILL-DRIVEN: a project's `skills/PRE_CAPTURE.md` (seeded with a
 * "skip" default at project creation — see `projectN01.server.ts`) is the
 * ONLY thing that decides whether this does anything at all. When it's
 * "skip" (the default), this is a total no-op — no files are examined, no
 * model is ever called. Otherwise, for every candidate source file that
 * doesn't already have a sibling `<name>-summary.md` next to it, an LLM is
 * asked — grounded in the skill's own instructions — to decide whether (and
 * how) to summarize it. Candidates come from two places:
 *
 *   - This project's daily-log Cards (every `::file{...}` attachment).
 *   - This project's own `syncs/` folder tree (every file, at any depth).
 *
 * WHY a separate sibling file, generated once, rather than summarizing
 * inline at capture time: the (real-money, non-deterministic) model call
 * happens exactly once per file and is cached as an ordinary vault file —
 * every later consumer (capture's own README-writing step, a human just
 * reading the daily log or syncs folder) gets a free, fast, plain-text
 * summary instead of needing its own model call.
 *
 * IDEMPOTENT against a hash of the source file's own bytes/content
 * (`content_hash`, falling back to `s3_key`/id) plus, for a Card
 * attachment, its caption — stored in the summary's own front matter
 * (`sourceHash`) and re-derived fresh on each call. Editing a caption or
 * replacing a file's bytes invalidates the cached summary; an unchanged
 * file is a total no-op.
 *
 * Deliberately writes into whichever folder the SOURCE file already lives
 * in -- the OWNING human's own `daily-logs` folder for a Card attachment
 * (never necessarily whoever triggered this run -- see below), or the
 * project's own `syncs/<connector>/` folder for a synced file -- never
 * gated by anything but the skill file itself (no `dryRun`, no
 * apply-gate): both are folders that file's own owner/the project owner
 * already has an existing write relationship with.
 *
 * CROSS-HUMAN BY DESIGN, same as `capture.server.ts`: when sweeping
 * every day (no `date`/`fileId` given), `listCardEntriesForProject`
 * (`dailyLog.server.ts`) enumerates every (humanId, date) pair with a
 * Card for this project across EVERY human who's ever written one, not
 * just `actingHumanId` -- a Card is already cross-human safe (any
 * Sharing Role, including Observer, may write one for a project they can
 * see), so a collaborator's attachment gets the exact same pre-capture
 * treatment the project owner's own would, regardless of who actually
 * runs `nopal phylog pre-capture`/`run`/`capture`.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter } from "./project.types";
import {
  extractFileAttachments,
  isImageContentType,
  summaryFileName,
} from "./sorter.server";
import {
  createFileRef,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { downloadFileBytes } from "./file.server";
import { getDailyLogCards, listCardEntriesForProject, type DailyLogCard } from "./dailyLog.server";
import { getProjectStageSkill, isSkipInstruction } from "./projectN01.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyLlmError, recordPhylogUsage } from "./phylogMetrics.server";
import type { LlmProvider, PhotoDescriber } from "./llmProvider";

export type PreCaptureCandidate = {
  fileId: string;
  name: string;
  /** Whichever Card the attachment came from, when applicable — used only
   * to ground the summary in more context; a synced file has none. */
  card?: DailyLogCard;
  caption: string;
};

export type PreCaptureSummary = {
  fileId: string;
  name: string;
  summaryFileId: string;
  /** True when a fresh summary was generated THIS call; false when an
   * already-up-to-date one was found and reused untouched. */
  generated: boolean;
};

export type PreCaptureResult = {
  ok: true;
  /** True when `skills/PRE_CAPTURE.md` is missing or says "skip" — a total
   * no-op, nothing was even examined. */
  skipped: boolean;
  summaries: PreCaptureSummary[];
  /** Candidates that couldn't be summarized (no readable text, not an
   * image) — reported so a human can see what's being silently left
   * behind, not just "nothing happened". */
  unsupported: { fileId: string; name: string }[];
} | { ok: false; error: string };

function sourceHash(basis: string, caption: string): string {
  return createHash("sha256").update(`${basis}|${caption}`).digest("hex").slice(0, 16);
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

function buildSummaryContent(input: {
  sourceFileId: string;
  hash: string;
  caption: string;
  body: string;
}): string {
  const frontmatter = stringifyYaml({
    source: input.sourceFileId,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  const parts = [`---\n${frontmatter}\n---`];
  if (input.caption) parts.push(`**Caption:** ${input.caption}`);
  parts.push(input.body);
  return parts.join("\n\n");
}

async function collectSyncCandidates(
  humanId: string,
  folderId: string,
): Promise<PreCaptureCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: PreCaptureCandidate[] = files
    .filter((f) => !f.name.endsWith("-summary.md"))
    .map((f) => ({ fileId: f._id, name: f.name, caption: "" }));
  for (const sub of folders) {
    out.push(...(await collectSyncCandidates(humanId, sub._id)));
  }
  return out;
}


function buildContext(input: { skill: string; card?: DailyLogCard; caption: string }): string {
  const parts = [`Pre-capture instructions for this project:\n\n${input.skill}`];
  if (input.card) parts.push(`Project: ${input.card.projectName}`);
  if (input.caption) parts.push(`The human's own caption for this file: "${input.caption}"`);
  if (input.card) parts.push(`Full Card text logged that day, for additional context:\n\n${input.card.content}`);
  return parts.join("\n\n");
}

/**
 * Runs pre-capture for one project. Pass `fileId` to process a single
 * file; `date` to process just that day's Card attachments (plus, always,
 * a syncs sweep); omit both to process EVERY day this project has a Card
 * for, plus the syncs sweep — the "all history" / "end-of-day sweep for
 * everything new" case (idempotency makes a repeat call of this cheap:
 * only genuinely new/changed files ever call the model).
 */
export async function runPreCapture(
  actingHumanId: string,
  projectFolder: VaultFolder,
  opts: { date?: string; fileId?: string; provider?: LlmProvider; photoDescriber?: PhotoDescriber } = {},
  onProgress?: (line: string) => void,
): Promise<PreCaptureResult> {
  const log = onProgress ?? (() => {});
  const skill = await getProjectStageSkill(projectFolder, "PRE_CAPTURE.md");
  if (isSkipInstruction(skill)) {
    log("pre-capture: skills/PRE_CAPTURE.md says skip — nothing to do.");
    await recordPhylogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "pre-capture",
      kind: "pipeline",
      durationMs: 0,
      outcome: "skipped",
    });
    return { ok: true, skipped: true, summaries: [], unsupported: [] };
  }
  // Backward-compat continuity: a project may already have a general
  // skills/SKILL.md predating this pipeline — fold it in too.
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  if (!opts.provider && !isPhylogAgentConfigured()) {
    return { ok: false, error: "PhyLog's agent is not configured (no ANTHROPIC_API_KEY set)." };
  }

  const candidates: PreCaptureCandidate[] = [];

  if (opts.fileId) {
    const file = await getFileRefById(opts.fileId);
    if (!file) return { ok: false, error: "File not found" };
    candidates.push({ fileId: file._id, name: file.name, caption: "" });
  } else {
    // Sweeps EVERY human's Cards for this project, not just whoever's
    // running this call -- same reasoning as `capture.server.ts`'s own
    // `listCardEntriesForProject` usage (see that file's module doc): a
    // Card is already cross-human safe by design, so a collaborator's
    // attachment deserves the same pre-capture summary as the project
    // owner's own would.
    const entries = opts.date
      ? await listCardEntriesForProject(projectFolder._id, { since: opts.date, until: opts.date })
      : await listCardEntriesForProject(projectFolder._id);
    for (const { humanId: cardHumanId, date } of entries) {
      const cards = await getDailyLogCards(cardHumanId, date);
      const card = cards.find((c) => c.projectFolderId === projectFolder._id);
      if (!card) continue;
      for (const attachment of extractFileAttachments(card.content)) {
        candidates.push({ fileId: attachment.fileId, name: attachment.name, card, caption: attachment.caption });
      }
    }

    const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
    const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
    if (syncsFolder) {
      candidates.push(...(await collectSyncCandidates(projectFolder.human_id, syncsFolder._id)));
    }
  }

  const summaries: PreCaptureSummary[] = [];
  const unsupported: { fileId: string; name: string }[] = [];
  let photoLlm: PhotoDescriber | undefined = opts.photoDescriber;
  let textLlm: LlmProvider | undefined = opts.provider;
  const skillContent = [skill, generalSkill].filter(Boolean).join("\n\n");

  for (const candidate of candidates) {
    const source = await getFileRefById(candidate.fileId);
    if (!source || !source.folder_id) {
      log(`pre-capture: candidate "${candidate.name}" (${candidate.fileId}) no longer resolves — skipped.`);
      continue;
    }
    if (source.name.endsWith("-summary.md")) continue;

    const hash = sourceHash(source.content_hash ?? source.s3_key ?? source._id, candidate.caption);
    const name = summaryFileName(source.name);
    const { files: siblings } = await listFolderChildren(source.human_id, source.folder_id);
    const existingListing = siblings.find((f) => f.name === name);
    const existing = existingListing ? await getFileRefById(existingListing._id) : undefined;

    if (existing && existingSourceHash(existing.content) === hash) {
      summaries.push({ fileId: source._id, name: source.name, summaryFileId: existing._id, generated: false });
      continue;
    }

    let body: string | null = null;
    const isImage = isImageContentType(source.content_type) && !!source.s3_key;
    const kind = isImage ? "photo-summary" : "text-summary";
    const callStart = Date.now();
    try {
      if (isImage) {
        photoLlm ??= new AnthropicProvider();
        const bytes = await downloadFileBytes(source.s3_key!);
        const result = await photoLlm.describePhoto({
          imageBase64: bytes.toString("base64"),
          mediaType: source.content_type,
          context: buildContext({ skill: skillContent, card: candidate.card, caption: candidate.caption }),
        });
        body = result.description;
        await recordPhylogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "pre-capture",
          kind,
          model: result.model,
          usage: result.usage,
          durationMs: Date.now() - callStart,
          outcome: "success",
        });
      } else if (source.content) {
        textLlm ??= new AnthropicProvider();
        const response = await textLlm.complete({
          system: `You are PhyLog's pre-capture step, summarizing a file per a project owner's own instructions. Follow those instructions closely; write only the summary itself, no preamble.\n\n${skillContent}`,
          messages: [
            {
              role: "user",
              content: `File name: ${source.name}\n\n${buildContext({ skill: skillContent, card: candidate.card, caption: candidate.caption })}\n\n---\n\nFile content:\n\n${source.content}`,
            },
          ],
          tools: [],
        });
        body = response.text?.trim() || null;
        await recordPhylogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "pre-capture",
          kind,
          model: response.model,
          usage: response.usage,
          durationMs: Date.now() - callStart,
          outcome: "success",
        });
      } else {
        unsupported.push({ fileId: source._id, name: source.name });
        log(`pre-capture: "${source.name}" has no readable content — skipped (no summary written).`);
        continue;
      }
    } catch (err) {
      // One bad/oversized file (e.g. an image over Anthropic's ~10MB base64
      // vision limit) must never abort the rest of the batch — this can
      // legitimately span dozens of files across many days/syncs.
      unsupported.push({ fileId: source._id, name: source.name });
      log(
        `pre-capture: "${source.name}" couldn't be summarized (${err instanceof Error ? err.message : "unknown error"}).`,
      );
      await recordPhylogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "pre-capture",
        kind,
        durationMs: Date.now() - callStart,
        outcome: "error",
        errorKind: classifyLlmError(err),
      });
      continue;
    }

    if (!body) {
      unsupported.push({ fileId: source._id, name: source.name });
      continue;
    }

    const content = buildSummaryContent({
      sourceFileId: source._id,
      hash,
      caption: candidate.caption,
      body,
    });
    const summaryFileId = existing
      ? (await updateFileRef(existing._id, { content }))?._id
      : (
          await createFileRef({
            human_id: source.human_id,
            name,
            content,
            content_type: "text/markdown",
            folder_id: source.folder_id,
            source: source.source,
            date: source.date,
          })
        )?._id;
    if (!summaryFileId) continue;

    log(`pre-capture: wrote "${name}" for "${source.name}".`);
    summaries.push({ fileId: source._id, name: source.name, summaryFileId, generated: true });
  }

  return { ok: true, skipped: false, summaries, unsupported };
}
