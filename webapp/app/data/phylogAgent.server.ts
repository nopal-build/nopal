/**
 * The PhyLog Agent — where the actual "AI magic" lives. Unlike the Sorter
 * (`sorter.server.ts`, deliberately zero-inference), this reads a day's
 * Card for a project plus that project's own `skills/SKILL.md` (its
 * steering instructions, if any) and asks an LLM whether the project's
 * `README.md` should change, via a small TOOL the model can choose to
 * call — `update_readme`.
 *
 * DESIGN NOTE (per the PhyLog design conversation): this is built as a
 * TOOL a model calls, not a hardcoded "always rewrite the README" step —
 * on purpose. The longer-term shape is PhyLog defining a growing set of
 * tools (sorting, filing, reverting, editing...) and an agent deciding
 * which to use, rather than us hardcoding a fixed pipeline. Today there's
 * exactly one tool (`update_readme`, scoped to the project's own
 * `README.md` body only — never front matter, never other files, never
 * `skills/`); `runAgentLoop` below is written generically so adding more
 * tools later doesn't require restructuring this file, just registering
 * them.
 *
 * Deliberately ON-DEMAND ONLY — never wired into the daily cron
 * (`sortAllDueDailyLogs`). Every call costs real money and produces
 * non-deterministic output, unlike the Sorter's free, deterministic
 * extraction; `isPhylogAgentConfigured()` (`anthropicProvider.server.ts`)
 * is the same "absent API key = disabled" kill switch `SORTER_ENABLED`
 * already established for the Sorter when IT was new.
 *
 * PREVIEW / DRY RUN: `dryRun: true` runs the exact same model call and
 * returns the proposed new README body WITHOUT writing anything — the
 * development/testing workflow asked for before this is trusted to write
 * for real. `dryRun: false` commits the change through the exact same
 * Release Log changeset/revert machinery every other project-file
 * mutation already uses (kind `"ai-update"`, a `"content-edit"`
 * changeset) — see `releaseLog.server.ts`'s own module doc for the
 * known limitation this reuse inherits (chained AI edits on the same file
 * aren't guaranteed to replay correctly after a revert).
 *
 * IDEMPOTENCY: keyed off a hash of the Card's OWN content (`source_ref`,
 * same mechanism the Sorter uses) — re-running `apply` against an
 * unchanged Card is a no-op REGARDLESS of what the model might generate
 * differently on a second call (it's never even invoked), since nothing
 * about the input changed. A `dryRun` call always invokes the model fresh
 * (the whole point of a preview is to see it live while iterating).
 */

import { createHash } from "node:crypto";
import {
  getDailyLogCards,
  getDailyLogFolderAndReadmeId,
  type DailyLogCard,
} from "./dailyLog.server";
import {
  createFileRef,
  getFileRefById,
  getFolderById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
} from "./vault.server";
import { splitFrontmatter } from "./project.types";
import {
  createReleaseLogEntry,
  findReleaseLogEntryBySource,
  regenerateDailyReleaseLog,
  regenerateProjectReleaseLog,
} from "./releaseLog.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import type {
  LlmMessage,
  LlmProvider,
  ToolCall,
  ToolDefinition,
} from "./llmProvider";

// ─── The one tool this agent can call today ────────────────────────────

const UPDATE_README_TOOL: ToolDefinition = {
  name: "update_readme",
  description:
    "Replace the project's README.md BODY (everything after its front matter, if any) with a new version. Call this only when today's Card content actually warrants a real update to the project's summary/status — skip it entirely on a day where nothing meaningfully changed. Never invent information that isn't grounded in the Card content or the README's own prior content.",
  inputSchema: {
    type: "object",
    properties: {
      newBody: {
        type: "string",
        description: "The full replacement README body (markdown, front matter excluded).",
      },
      reason: {
        type: "string",
        description: "One sentence explaining what changed and why, for the Release Log.",
      },
    },
    required: ["newBody", "reason"],
  },
};

function withReadmeBody(originalMarkdown: string, newBody: string): string {
  const { frontmatter } = splitFrontmatter(originalMarkdown);
  if (!frontmatter) return newBody;
  return `---\n${frontmatter}\n---\n${newBody}`;
}

// ─── Generic agent loop (provider- and tool-count-agnostic) ────────────

async function runAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  tools: ToolDefinition[],
  executors: Record<string, (input: Record<string, unknown>) => Promise<string>>,
  maxTurns = 4,
): Promise<{ transcript: LlmMessage[]; toolCallsMade: ToolCall[] }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await provider.complete({ system, messages, tools });
    messages.push({
      role: "assistant",
      content: response.text ?? "",
      toolCalls: response.toolCalls,
    });
    if (response.toolCalls.length === 0) break;

    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor
        ? await executor(call.input)
        : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
  }

  return { transcript: messages, toolCallsMade };
}

// ─── Prompt construction ────────────────────────────────────────────────

async function getProjectSkillContent(projectFolder: {
  human_id: string;
  _id: string;
}): Promise<string | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find(
    (f) => f.folder_type === "skills" && f.is_folder_type_root,
  );
  if (!skillsFolder) return null;

  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);
  const skillListing = files.find((f) => f.name.toLowerCase() === "skill.md");
  if (!skillListing) return null;

  const skillFile = await getFileRefById(skillListing._id);
  return skillFile?.content ?? null;
}

const SYSTEM_PROMPT = `You are PhyLog, an agent that helps a project's documentation evolve alongside the work actually being done on it.

You will be given:
- A project's own SKILL.md instructions (if the project has defined any) — these are the project owner's own steering guidance for how you should think, write, and what matters to them. Follow them closely when present.
- One day's Card content for this project — the human's own notes, completed tasks, and file attachments logged against this project that day.
- The project's current README.md.

Decide whether today's Card content warrants a real update to the README. Most days, especially quiet ones, it will not — do nothing (don't call any tool) rather than making a cosmetic or speculative edit. When it genuinely does, call update_readme with the FULL new body (not a diff, not just the changed part) and a one-sentence reason.

Never fabricate progress, dates, or facts that aren't grounded in the Card content or the README's own existing content.`;

function buildUserPrompt(input: {
  skillContent: string | null;
  cardContent: string;
  readmeContent: string;
}): string {
  const parts: string[] = [];
  if (input.skillContent) {
    parts.push(`## Project SKILL.md\n\n${input.skillContent}`);
  }
  parts.push(`## Today's Card content\n\n${input.cardContent || "(empty)"}`);
  parts.push(`## Current README.md\n\n${input.readmeContent || "(empty)"}`);
  return parts.join("\n\n---\n\n");
}

// ─── Orchestration ──────────────────────────────────────────────────────

export type PhylogAgentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Whether the model decided a README update was warranted at all. */
      proposedChange: boolean;
      /** Present only when `proposedChange` is true. */
      newReadmeBody?: string;
      reason?: string;
      /** Whether this was actually committed (`dryRun: false`) or only
       * previewed (`dryRun: true`). */
      applied: boolean;
      /** True when `applied` is true because an identical Card content
       * hash was already filed before — the model was never even called
       * this time. */
      alreadyApplied?: boolean;
    };

export type RunPhylogAgentOptions = {
  dryRun: boolean;
  provider?: LlmProvider;
};

/**
 * Runs the PhyLog agent for one project's Card on one day. See this
 * file's own module doc for the full design; this is the single entry
 * point both the CLI and the API route call.
 */
export async function runPhylogAgent(
  actingHumanId: string,
  projectFolderId: string,
  date: string,
  { dryRun, provider }: RunPhylogAgentOptions,
): Promise<PhylogAgentResult> {
  // Both dryRun and a real apply call the model — only the WRITE at the
  // end is conditional on `dryRun`, so this check is unconditional too.
  if (!provider && !isPhylogAgentConfigured()) {
    return { ok: false, error: "PhyLog's agent is not configured (no ANTHROPIC_API_KEY set)." };
  }

  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) return { ok: false, error: "Project not found" };

  const cards = await getDailyLogCards(actingHumanId, date);
  const card = cards.find((c) => c.projectFolderId === projectFolderId);
  if (!card) {
    return { ok: false, error: "No Card found for this project on this day" };
  }

  const contentHash = createHash("sha256").update(card.content).digest("hex").slice(0, 16);
  const sourceRef = `${card.fileId}:${contentHash}`;

  if (!dryRun) {
    const existing = await findReleaseLogEntryBySource(
      projectFolderId,
      date,
      "ai-update",
      sourceRef,
    );
    if (existing) {
      return { ok: true, proposedChange: true, applied: true, alreadyApplied: true };
    }
  }

  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolderId);
  const readmeContent = readme?.content ?? "";
  const skillContent = await getProjectSkillContent(projectFolder);

  const llm = provider ?? new AnthropicProvider();
  const userPrompt = buildUserPrompt({
    skillContent,
    cardContent: card.content,
    readmeContent,
  });

  const { toolCallsMade } = await runAgentLoop(
    llm,
    SYSTEM_PROMPT,
    userPrompt,
    [UPDATE_README_TOOL],
    {
      update_readme: async () => "Recorded.",
    },
  );

  const updateCall = toolCallsMade.find((c) => c.name === "update_readme");
  if (!updateCall) {
    return { ok: true, proposedChange: false, applied: false };
  }

  const newBody = String(updateCall.input.newBody ?? "");
  const reason = String(updateCall.input.reason ?? "");

  if (dryRun) {
    return { ok: true, proposedChange: true, newReadmeBody: newBody, reason, applied: false };
  }

  // ── Apply for real ──────────────────────────────────────────────────
  const oldFullContent = readmeContent;
  const newFullContent = withReadmeBody(oldFullContent, newBody);

  let readmeFileId = readme?._id;
  if (!readme) {
    const created = await createFileRef({
      human_id: projectFolder.human_id,
      name: "README.md",
      content: newFullContent,
      content_type: "text/markdown",
      folder_id: projectFolderId,
    });
    readmeFileId = created?._id;
  } else {
    await updateFileRef(readme._id, { content: newFullContent });
  }
  if (!readmeFileId) return { ok: false, error: "Failed to write README.md" };

  await createReleaseLogEntry({
    projectFolderId,
    date,
    actingHumanId,
    kind: "ai-update",
    summary: `PhyLog updated the README — [View](/fruits/vault?file=${readmeFileId}): ${reason}`,
    sourceRef,
    changesets: [
      {
        fileId: readmeFileId,
        action: "content-edit",
        before: { content: oldFullContent },
        after: { content: newFullContent },
      },
    ],
  });

  await regenerateProjectReleaseLog(projectFolderId);
  const { dateFolderId } = await getDailyLogFolderAndReadmeId(actingHumanId, date);
  await regenerateDailyReleaseLog(actingHumanId, date, dateFolderId);

  return { ok: true, proposedChange: true, newReadmeBody: newBody, reason, applied: true };
}

export type { DailyLogCard };
