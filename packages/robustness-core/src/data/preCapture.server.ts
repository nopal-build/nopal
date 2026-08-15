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
 * happens exactly once per file and is cached as an ordinary vault file --
 * every later consumer (capture's own organize/README step, a human just
 * browsing the project's daily-logs/syncs folders) gets a free, fast,
 * plain-text summary instead of needing its own model call.
 *
 * IDEMPOTENT against a hash of the source file's own bytes/content
 * (`content_hash`, falling back to `s3_key`/id) plus, for a Card
 * attachment, its caption — stored in the summary's own front matter
 * (`sourceHash`) and re-derived fresh on each call. Editing a caption or
 * replacing a file's bytes invalidates the cached summary; an unchanged
 * file is a total no-op.
 *
 * TWO DIFFERENT destinations, by design:
 *   - A CARD attachment's summary (and a visible COPY of the attachment
 *     itself) is written into the PROJECT's own
 *     `daily-logs/<date>-<person>/` entry folder (`projectN01.server.ts`'s
 *     `findDailyLogEntry`/`createDailyLogEntryFolder`/
 *     `writeDailyLogEntryMeta`) -- NEVER back into the contributing
 *     human's own personal vault. This is the actual behavior change
 *     from pre-capture's earlier design
 *     (which wrote the summary as a sibling of the original attachment,
 *     in the CONTRIBUTOR's own `daily-logs/YYYY-MM-DD/` folder): now
 *     every project's own `daily-logs/` folder is a browsable, staged
 *     mirror of "what's pending to be organized", grouped by day AND
 *     contributor, and `capture.server.ts` reads its organize/README
 *     decisions FROM this staged copy (`card.md` + summaries), never
 *     from the original Card or the human's own vault directly.
 *   - A SYNCED file's summary (no Card involved) still writes as a
 *     sibling right next to it, inside the project's own
 *     `syncs/<connector>/` tree -- unchanged. `capture.server.ts` reads
 *     `syncs/` directly too, alongside `daily-logs/`.
 *   - The `--file <path>` single-file debug path (`opts.fileId`) is ALSO
 *     unchanged -- writes a sibling summary next to whatever arbitrary
 *     file was targeted, regardless of whether it happens to be a Card
 *     attachment. A deliberate, narrow scope boundary: there's no
 *     (day, contributor) context to stage into for an arbitrary
 *     single-file call.
 * Never gated by anything but the skill file itself (no `dryRun`, no
 * apply-gate) -- every one of these destinations is a folder PhyLog's own
 * server-side code already has an unconditional write relationship with.
 *
 * CROSS-HUMAN BY DESIGN, same as `capture.server.ts`: when sweeping
 * every day (no `date`/`fileId` given), `listCardEntriesForProject`
 * (`dailyLog.server.ts`) enumerates every (humanId, date) pair with a
 * Card for this project across EVERY human who's ever written one, not
 * just `actingHumanId` -- a Card is already cross-human safe (any
 * Sharing Role, including Observer, may write one for a project they can
 * see), so a collaborator's attachment gets the exact same pre-capture
 * treatment (and the exact same `daily-logs/<date>-<person>/` staging)
 * the project owner's own would, regardless of who actually runs
 * `nopal phylog pre-capture`/`run`/`capture`.
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
  copyFileIntoFolder,
  createFileRef,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { downloadFileBytes } from "./file.server";
import { getDailyLogCards, listCardEntriesForProject, type DailyLogCard } from "./dailyLog.server";
import {
  CARD_COPY_FILE,
  createDailyLogEntryFolder,
  findDailyLogEntry,
  getProjectStageSkill,
  isSkipInstruction,
  listDailyLogEntries,
  listExtraSkillFiles,
  writeDailyLogEntryMeta,
  type DailyLogEntryMeta,
} from "./projectN01.server";
import { getHumansById } from "./humans.server";
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
  /** Where the generated summary (and, for a Card attachment, a visible
   * COPY of the attachment itself — see the loop below) gets written.
   * Defaults to the SOURCE file's own folder/owner when omitted (syncs
   * files, and the `--file` single-file debug path, both unaffected by
   * the daily-logs redesign). A Card attachment instead points this at
   * its project's own `daily-logs/<date>-<person>/` entry folder — see
   * the module doc's "Card attachments land in daily-logs" section. */
  dest?: { humanId: string; folderId: string };
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
  /** True when `skills/PRE_CAPTURE.md` is missing or says "skip" —
   * SUMMARIZATION was skipped (no LLM calls, `summaries`/`unsupported`
   * are both empty). In sweep mode (no `fileId`), daily-logs STAGING
   * still ran regardless — see `runPreCapture`'s own doc for why. Only
   * ever a true total no-op for the single-`fileId` debug path. */
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
 * file (a pure summarization debug path, fully skill-gated, no daily-logs
 * staging involved); `date` to stage/summarize just that day's Card
 * entries (plus, always, a syncs summary sweep); omit both to stage/
 * summarize EVERY day this project has a Card for, plus the syncs sweep
 * — the "all history" / "end-of-day sweep for everything new" case
 * (idempotency makes a repeat call of this cheap: only genuinely
 * new/changed files ever call the model).
 *
 * STAGING (populating `daily-logs/<date>-<person>/` with `card.md` +
 * visible attachment copies) is UNCONDITIONAL in sweep mode — it always
 * runs, regardless of `skills/PRE_CAPTURE.md`. Only SUMMARIZATION (the
 * real-money LLM calls that generate `*-summary.md` siblings, for both
 * Card attachments and synced files) is gated by that skill file, same as
 * before. This split matters: `skills/PRE_CAPTURE.md` is seeded "skip" by
 * DEFAULT for every new project (see `projectN01.server.ts`), and
 * `capture.server.ts` now reads ITS OWN input exclusively from
 * `daily-logs/` (see that file's module doc) — if staging were ALSO
 * gated on the skill file, a brand new, still-default project would never
 * get ANY daily-logs entries at all, and capture would have nothing to
 * work from. The `--file` single-file path has no such staging concept
 * (there's no (day, contributor) to stage into for an arbitrary file), so
 * it stays fully skill-gated, unchanged.
 */
export async function runPreCapture(
  actingHumanId: string,
  projectFolder: VaultFolder,
  opts: { date?: string; fileId?: string; provider?: LlmProvider; photoDescriber?: PhotoDescriber } = {},
  onProgress?: (line: string) => void,
): Promise<PreCaptureResult> {
  const log = onProgress ?? (() => {});
  const skill = await getProjectStageSkill(projectFolder, "PRE_CAPTURE.md");
  const skipSummaries = isSkipInstruction(skill);

  if (opts.fileId && skipSummaries) {
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
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  if (!skipSummaries && !opts.provider && !isPhylogAgentConfigured()) {
    return { ok: false, error: "PhyLog's agent is not configured (no ANTHROPIC_API_KEY set)." };
  }
  if (skipSummaries) {
    log(
      "pre-capture: skills/PRE_CAPTURE.md says skip — staging daily-logs content, generating no summaries.",
    );
  }

  const candidates: PreCaptureCandidate[] = [];
  // One entry per (humanId, date) Card actually seen this run -- used
  // AFTER the main summarization loop below to refresh each entry
  // folder's own `_meta.md` (needs every attachment's hash, which the
  // loop computes one candidate at a time -- see `attachmentHashesByEntry`).
  const entryMetaInputs: {
    entryFolder: VaultFolder;
    humanId: string;
    humanName: string;
    date: string;
    cardFileId: string;
    cardContent: string;
  }[] = [];

  if (opts.fileId) {
    const file = await getFileRefById(opts.fileId);
    if (!file) return { ok: false, error: "File not found" };
    candidates.push({ fileId: file._id, name: file.name, caption: "" });
  } else {
    // Sweeps EVERY human's Cards for this project, not just whoever's
    // running this call -- same reasoning as `capture.server.ts`'s own
    // `listCardEntriesForProject` usage (see that file's module doc): a
    // Card is already cross-human safe by design, so a collaborator's
    // attachment deserves the same pre-capture staging the project
    // owner's own would.
    const entries = opts.date
      ? await listCardEntriesForProject(projectFolder._id, { since: opts.date, until: opts.date })
      : await listCardEntriesForProject(projectFolder._id);

    if (entries.length > 0) {
      // Batched human-name lookup for nicer entry-folder labels (e.g.
      // "2026-08-14-gerald" instead of "2026-08-14-human_1") -- purely
      // cosmetic, never load-bearing for lookup (see
      // `createDailyLogEntryFolder`'s own doc).
      const humans = await getHumansById([...new Set(entries.map((e) => e.humanId))]);
      const humanNameById = new Map(humans.map((h) => [h._id, h.name || h.email]));

      // Fetched ONCE for the whole sweep, then looked up per-Card via the
      // pure `findDailyLogEntry` -- calling `getOrCreateDailyLogEntryFolder`
      // itself once per Card would re-scan the ENTIRE daily-logs folder
      // on every single one, an O(cards * entries) blowup that's the
      // actual reason this stage can feel slow on a project with real
      // history. See `findDailyLogEntry`'s own doc.
      const existingDailyLogEntries = await listDailyLogEntries(projectFolder);

      for (const { humanId: cardHumanId, date } of entries) {
        const cards = await getDailyLogCards(cardHumanId, date);
        const card = cards.find((c) => c.projectFolderId === projectFolder._id);
        if (!card) continue;

        const humanName = humanNameById.get(cardHumanId) ?? cardHumanId;
        const entryFolder =
          findDailyLogEntry(existingDailyLogEntries, cardHumanId, date)?.folder ??
          (await createDailyLogEntryFolder(projectFolder, { humanId: cardHumanId, humanName, date }));

        // Keep the entry's own `card.md` copy current -- a plain overwrite
        // (cheap, no LLM call), so capture always reads the Card's LATEST
        // text even on a day it doesn't otherwise need re-summarizing.
        const { files: entryFiles } = await listFolderChildren(entryFolder.human_id, entryFolder._id);
        const cardCopyListing = entryFiles.find((f) => f.name === CARD_COPY_FILE);
        if (cardCopyListing) {
          const existingCopy = await getFileRefById(cardCopyListing._id);
          if (existingCopy && existingCopy.content !== card.content) {
            await updateFileRef(cardCopyListing._id, { content: card.content });
          }
        } else {
          await createFileRef({
            human_id: entryFolder.human_id,
            name: CARD_COPY_FILE,
            content: card.content,
            content_type: "text/markdown",
            folder_id: entryFolder._id,
          });
        }

        const dest = { humanId: entryFolder.human_id, folderId: entryFolder._id };
        for (const attachment of extractFileAttachments(card.content)) {
          candidates.push({ fileId: attachment.fileId, name: attachment.name, card, caption: attachment.caption, dest });
        }

        entryMetaInputs.push({
          entryFolder,
          humanId: cardHumanId,
          humanName,
          date,
          cardFileId: card.fileId,
          cardContent: card.content,
        });
      }
    }

    // Syncs has no separate "staging" concept -- summarizing IS the only
    // thing pre-capture does there, so this whole sweep is skill-gated
    // (unlike the Card-attachment staging above, which just ran
    // regardless of `skipSummaries`).
    if (!skipSummaries) {
      const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
      const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
      if (syncsFolder) {
        candidates.push(...(await collectSyncCandidates(projectFolder.human_id, syncsFolder._id)));
      }
    }
  }

  const summaries: PreCaptureSummary[] = [];
  const unsupported: { fileId: string; name: string }[] = [];
  let photoLlm: PhotoDescriber | undefined = opts.photoDescriber;
  let textLlm: LlmProvider | undefined = opts.provider;
  const skillContent = [
    skill,
    generalSkill,
    ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  // `${entryFolderId}:${attachmentFileId}:${hash}` strings, collected as
  // the loop below processes each Card-attachment candidate -- folded
  // into that entry's own `_meta.md.sourceHash` once the whole loop
  // finishes (see `entryMetaInputs` above).
  const attachmentHashesByEntry = new Map<string, string[]>();

  for (const candidate of candidates) {
    const source = await getFileRefById(candidate.fileId);
    if (!source || !source.folder_id) {
      log(`pre-capture: candidate "${candidate.name}" (${candidate.fileId}) no longer resolves — skipped.`);
      continue;
    }
    if (source.name.endsWith("-summary.md")) continue;

    const hash = sourceHash(source.content_hash ?? source.s3_key ?? source._id, candidate.caption);
    const destHumanId = candidate.dest?.humanId ?? source.human_id;
    const destFolderId = candidate.dest?.folderId ?? source.folder_id;

    // ONE fetch of the destination folder's current children, reused for
    // both checks below (the attachment-copy check and the
    // already-summarized check) -- these used to be two separate
    // `listFolderChildren` round trips against the exact same folder.
    const { files: destFiles } = await listFolderChildren(destHumanId, destFolderId);

    if (candidate.dest) {
      const list = attachmentHashesByEntry.get(candidate.dest.folderId) ?? [];
      list.push(`${source._id}:${hash}`);
      attachmentHashesByEntry.set(candidate.dest.folderId, list);

      // A visible COPY of the attachment itself, so a human browsing
      // daily-logs/<date>-<person>/ sees the actual photo/file, not just
      // its summary -- idempotent by NAME (re-running never re-copies
      // the same attachment into the same entry folder twice; a genuine
      // rename upstream would be treated as a new file here, a known,
      // acceptable gap rather than tracked identity).
      if (!destFiles.some((f) => f.name === source.name)) {
        await copyFileIntoFolder(source._id, destFolderId);
      }
    }

    // Everything above (hash tracking, the visible attachment copy) is
    // UNCONDITIONAL staging -- only the summary generation below is
    // gated by `skills/PRE_CAPTURE.md`.
    if (skipSummaries) continue;

    const name = summaryFileName(source.name);
    const existingListing = destFiles.find((f) => f.name === name);
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
        if (response.stopReason === "max_tokens") {
          // Same class of issue capture's runAgentLoop guards against:
          // the model's own output limit cut generation off mid-summary,
          // so whatever text came back may be an incomplete fragment.
          // Never persist it as if it were a finished summary -- log it,
          // record it as an error (visible on /fruits/maker), and leave
          // this file unsummarized so the next pre-capture run retries it.
          log(`pre-capture: "${source.name}"'s summary was cut off by the model's own output limit -- skipped, will retry next run.`);
          await recordPhylogUsage({
            humanId: actingHumanId,
            projectFolderId: projectFolder._id,
            stage: "pre-capture",
            kind,
            model: response.model,
            usage: response.usage,
            durationMs: Date.now() - callStart,
            outcome: "error",
            errorKind: "incomplete",
          });
          unsupported.push({ fileId: source._id, name: source.name });
          continue;
        }
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
            human_id: destHumanId,
            name,
            content,
            content_type: "text/markdown",
            folder_id: destFolderId,
            // A daily-logs-destined summary is NOT part of anyone's own
            // personal daily-log timeline anymore (it lives in the
            // PROJECT's own tree) -- only carry these markers over for
            // the unaffected sibling-write cases (syncs, --file).
            source: candidate.dest ? undefined : source.source,
            date: candidate.dest ? undefined : source.date,
          })
        )?._id;
    if (!summaryFileId) continue;

    log(`pre-capture: wrote "${name}" for "${source.name}".`);
    summaries.push({ fileId: source._id, name: source.name, summaryFileId, generated: true });
  }

  // Refresh every touched entry folder's own `_meta.md` -- ALWAYS (even
  // when nothing needed re-summarizing this run), so `sourceHash` stays
  // an accurate reflection of "card.md + every current attachment" for
  // capture's own idempotency check to key off, and `updatedAt` records
  // that pre-capture genuinely looked at this entry just now.
  for (const input of entryMetaInputs) {
    const attachmentHashes = (attachmentHashesByEntry.get(input.entryFolder._id) ?? []).sort();
    const overallHash = createHash("sha256")
      .update(`${input.cardContent}|${attachmentHashes.join(",")}`)
      .digest("hex")
      .slice(0, 16);
    const meta: DailyLogEntryMeta = {
      humanId: input.humanId,
      humanName: input.humanName,
      date: input.date,
      cardFileId: input.cardFileId,
      sourceHash: overallHash,
      updatedAt: new Date().toISOString(),
    };
    await writeDailyLogEntryMeta(input.entryFolder, meta);
  }

  return { ok: true, skipped: skipSummaries, summaries, unsupported };
}
