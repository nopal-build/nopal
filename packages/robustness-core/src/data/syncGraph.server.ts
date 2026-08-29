/**
 * GraphLog's `sync-graph` stage — the second AGENTIC stage (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph (this file)
 *     -> graph-project-view
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog/PhyLog stage: a project's `skills/GRAPH.md` (seeded
 * with real starter instructions, NOT "skip" — see `graphLogDefaults.server.ts`)
 * decides whether/how this runs at all.
 *
 * Reads every file under a project's `syncs/` tree that carries a `date`
 * field (today, only `daily-log-sync`'s own output does — see that
 * file's own `date: entryDate` stamp), plus each one's sibling
 * `_knowledge/<name>.knowledge.md` if `sync-knowledge` already produced
 * one, and asks an LLM (grounded in `GRAPH.md`'s own instructions) to
 * extract citable NODES — verbatim or near-verbatim statements worth
 * remembering on their own — into `Graph/graph-log-YYYY-MM-DD.md`, one
 * file per day that has anything worth capturing (a day can legitimately
 * produce none at all).
 *
 * A REAL ARCHITECTURE CHANGE FROM THIS STAGE'S ORIGINAL SHAPE: one day's
 * worth of node extraction used to be ONE non-tool completion producing
 * the ENTIRE day's `graph-log-*.md` body in one shot. Confirmed against a
 * real project's real history that this genuinely truncates on a busy day
 * (`2026-08-13`'s output cut off at the shared 8192-token default) — the
 * exact same class of "one completion's output scales with how much
 * content there is" problem `graph-structure.server.ts` already hit and
 * fixed at the whole-graph level (see that file's own module doc). NOW: a
 * bounded tool-calling loop (`add_node`, one tool call per node) builds
 * the day up incrementally, so the OUTPUT of any single completion is now
 * just one node's worth of text, not a whole day's, and the original
 * truncation mode is no longer reachable in ordinary use.
 *
 * A DAY IS NO LONGER ALL-OR-NOTHING, AND IS NO LONGER ONE CONVERSATION.
 * Both of those were real, confirmed defects rather than design choices,
 * and they compounded each other.
 *
 * With one node added per turn, `MAX_TURNS` and "how many nodes a day may
 * hold" were the same number: a runaway-loop guard had silently become a
 * data ceiling at about 29 nodes. A day that reached it had EVERY node
 * discarded before the write, recorded as a retryable error, and retried
 * next run against the identical limit, failing identically, forever. It
 * was not silent and it was not recoverable, and the log line said "will
 * retry next run" about something that never could succeed. Run 16's
 * timeline shows how near that was: five nodes took six turns, so two
 * people writing normally reached seventeen and three reached the wall.
 *
 * NOW: a day is a LOOP OF PASSES over the same sources. Each pass is a
 * fresh, small conversation bounded by `MAX_TURNS`, is told what today
 * already holds so it doesn't repeat itself, and commits what it captured
 * into shared executor state before the next pass starts. The loop ends
 * when a pass adds nothing new, which is the model saying these sources
 * are exhausted. `MAX_TURNS` now bounds a PASS, which is what a
 * runaway-loop guard should bound (ADR-013), and there is no node ceiling
 * left at all, only a cost curve.
 *
 * AND A DAY IS ALWAYS WRITTEN. If a day ends early for any reason, every
 * node captured is still written to its file, and the file is written
 * WITHOUT its `sourceHash` so the next run cannot mistake it for finished
 * and reprocesses it from source. The shortfall is reported on the run
 * (see `SyncGraphResult.incomplete`). A partial day that says it is
 * partial is strictly better than no day claiming it will retry, and this
 * is the only place in this pipeline that could ever lose a person's
 * actual writing.
 *
 * A REAL, CONFIRMED FOLLOW-ON BUG, found against a real production run of
 * the redesign above (not theoretical): "one tool call per node" was only
 * ever a PROMPT-level assumption, not an enforced one -- Anthropic is free
 * to return several `tool_use` blocks in a single response, and on a busy
 * day the model batched multiple `add_node` calls into one turn, growing
 * that turn's own output past the shared 8192-token ceiling anyway -- the
 * exact same truncation class the redesign above was meant to eliminate,
 * just recreated one level up (per-turn instead of per-day). Fixed the
 * same way every other "never trust the model with something code can
 * just enforce" bug in this file already was: `runSyncGraphDayLoop` now
 * only EXECUTES the first `add_node` call in a given turn; any extra call
 * in that same turn is rejected (told to retry on a later turn) rather
 * than applied, so a turn's own necessary output is now actually bounded
 * to one node, not just asked to be. The system prompt and the tool's own
 * description were also reworded to ask for this directly -- belt and
 * suspenders, since a clearer prompt still reduces how often the reject-
 * and-retry path even needs to fire.
 *
 * Each node gets a plain, predictable `### Node <N>` heading (an
 * incrementing counter per day's file, never an LLM-generated title —
 * see `GRAPH.md`) and a verbose `:ref{...}` citation
 * (`oxmarkdown-core`'s `buildRefDirectiveMarkdown`) — PRE-COMPUTED here,
 * ATTACHED BY CODE THROUGH `add_node`'s OWN `sourceIndex` PARAMETER, so
 * the model never has to write (or copy) a citation's markdown at all —
 * a step further than the original design's "hand it verbatim text to
 * copy," which still left room for a long attribute string to get
 * mangled in transcription. Links (`sameDayLinks`/`backwardLinks`,
 * by node id) are VALIDATED by code against the actual candidate set
 * before being accepted — an id not in that list is silently dropped
 * and reported back to the model, rather than a hallucinated link
 * quietly ending up in the file the way free-form markdown could before.
 * Cross-day links point only BACKWARD (enforced here, not just
 * instructed) — the candidate list is `Graph/graph-structure.md` (see
 * `graphStructure.server.ts`), folded into the CACHED system prompt
 * (stable across every day this run touches, so it's only paid for once
 * per run, not resent per day — see "Prompt caching" below), falling
 * back to a plain scan of every existing graph-log file's headings for a
 * project that's never had graph-structure run yet. A node may ALSO link
 * to another node from the SAME day's file, in either direction, via
 * `sameDayLinks` — validated against node numbers already added earlier
 * in the SAME turn/day.
 *
 * PROMPT CACHING: `graph-structure.md`'s own content (and the shared
 * skill instructions) are now part of the SYSTEM prompt, which is
 * byte-identical across every day AND every turn this run touches —
 * `cacheSystemPrompt` (already used for exactly this reason elsewhere in
 * GraphLog/PhyLog) means a multi-day run pays full price for that block
 * ONCE, then a cheap cache-read for every day/turn after. Previously this
 * (often large) block lived in the per-day USER message and was resent
 * at full price on every single day of a run — a real, avoidable cost a
 * multi-day catch-up run would otherwise pay repeatedly for no reason.
 *
 * IDEMPOTENT via an aggregate hash of that day's candidates' own
 * `content_hash` PLUS each one's knowledge-sidecar hash (so a
 * `KNOWLEDGE.md` change that only touches the sidecar still invalidates
 * the day, not just a source-file edit) — stored in the graph-log file's
 * own front matter. An unchanged day is a total no-op. A CHANGED day's
 * existing `graph-log-*.md` is DELETED and fully regenerated — never
 * partially patched (see the `graphlog` skill's own doc on why: node
 * extraction is a single holistic judgment over the whole day, not
 * something that composes incrementally the way `graph-project-view`'s
 * `update_section` does for a README, or `graph-structure`'s own
 * `update_cluster` does for an existing thread — a day's raw source
 * content doesn't have the kind of stable identity a graph NODE or a
 * README SECTION already has to diff against).
 *
 * A REAL, CONFIRMED GAP, FOUND AND FIXED: an attached FILE (a photo, a
 * PDF, ...) had NO path into the graph at all, regardless of what either
 * skill said. `dailyLogSync.server.ts` copies a Card's `::file{...}`
 * attachments into the vault, but never stamped `date` on the COPY the
 * way it does for the Card's own text file -- so `collectDatedCandidates`
 * (below, `!!f.date`) silently excluded every attachment from ever
 * becoming a candidate here. `sync-knowledge` still described it into a
 * `_knowledge/*.knowledge.md` sidecar, but nothing ever read that sidecar
 * back in, so the description dead-ended. Fixed at the source:
 * `dailyLogSync.server.ts` now stamps `date` on a copied attachment too,
 * so it flows through the exact same per-day candidate pipeline a Card's
 * text already does. A file-backed candidate is only offered as a source
 * once it has a real knowledge-derived DESCRIPTION or a real human-
 * written CAPTION to ground a node in (never fabricated from an unseen
 * photo) -- a caption is deliberately just as sufficient on its own as a
 * description, since it's the uploader's own words, zero AI involved, and
 * shouldn't need `sync-knowledge` switched on (a real cost, off by
 * default) just to be reachable. The caption itself lives on the CARD's
 * own `::file{...}` attributes, never on the copied attachment file, so
 * it's recovered per day by re-scanning each of that day's Card
 * candidates and matching by the attachment's own synced name
 * (`captionByAttachmentName` below).
 *
 * NOT rendered as a `::file{...}` directive, deliberately -- an attached
 * file is appended to its node's own text as ORDINARY markdown
 * (`buildAttachedMediaMarkdown` below), BY CODE, never typed out by the
 * model, same reasoning `:ref{...}` already follows, shaped by the file's
 * REAL content type: an image is `![alt](url)`; a video is `[alt](url)`
 * with the url carrying `?type=video` (a real, clickable link even
 * somewhere that's never heard of this convention, unlike an `<img>`
 * pointed at a video file, which would just be broken -- and the same
 * marker `OxRenderer.tsx`'s own gallery collector looks for to upgrade it
 * into a real `<video controls>` player); anything else (a PDF, a doc,
 * ...) is a plain `[name](url)` link, never gallery-eligible at all.
 * Ordinary markdown degrades gracefully anywhere (no directive support
 * needed) and, unlike a one-file-at-a-time `::file{...}` mount, several
 * photos/videos can be freely grouped under one shared
 * `:::gallery{}...:::` container by whichever LATER stage is actually
 * laying out a page (see `graph-project-view`'s own "Files travel with
 * their nodes" note) -- the image/link line itself never has to be
 * rebuilt to make that grouping happen. From there the file travels for
 * free: it's just part of the node's permanent text, so `graph-structure`'s
 * pre-fetch and `graph-project-view`'s own node text see it automatically,
 * with no separate plumbing needed downstream.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildRefDirectiveMarkdown } from "oxmarkdown-core";
import { splitFrontmatter } from "./project.types";
import {
  createFileRef,
  deleteFileRef,
  getFileRefById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { getHumansById } from "./humans.server";
import {
  ensureProjectGraphFolder,
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import { parseSyncedCardFileName, parseSyncedAttachmentFileName, syncedAttachmentFileName } from "./dailyLogSync.server";
import { extractFileAttachments } from "./sorter.server";
import { KNOWLEDGE_FOLDER_NAME } from "./syncKnowledge.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { planTurnToolCalls } from "./llmProvider";
import type { LlmMessage, LlmProvider, LlmUsage, ToolDefinition } from "./llmProvider";

const GRAPH_LOG_PREFIX = "graph-log-";

function graphLogFileName(date: string): string {
  return `${GRAPH_LOG_PREFIX}${date}.md`;
}

function dateFromGraphLogFileName(name: string): string | null {
  const match = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
  return match ? match[1] : null;
}

/** Best-effort GFM-style heading slug — good enough for a link to work
 * once/if `OxRenderer` ever emits real heading `id`s (not required for
 * `graph-project-view` itself, which parses this file's raw markdown
 * structurally, never relies on browser anchor-scrolling). */
function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type NodeHeading = { heading: string; slug: string };

function extractHeadings(markdown: string): NodeHeading[] {
  const out: NodeHeading[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^###\s+(.+)$/.exec(line.trim());
    if (match) out.push({ heading: match[1].trim(), slug: slugifyHeading(match[1].trim()) });
  }
  return out;
}

export function existingSourceHash(content: string | null): string | null {
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

/**
 * `hash` is null when this day was written INCOMPLETE -- some of its
 * sources were captured and some were not.
 *
 * Writing no `sourceHash` is what makes the day come back. The day's
 * up-to-date check compares the stored hash against a freshly computed
 * one, so a day with no stored hash can never match, and the next run
 * reprocesses it from its sources. The captured nodes are real, permanent
 * and immediately usable by every downstream stage in the meantime, which
 * is the whole point: a partial day that says it is partial is strictly
 * better than no day at all (ADR-011).
 *
 * Never "fix" this by stamping the hash anyway to save the reprocessing
 * cost. That is precisely the move that would make a partial day look
 * finished and lose the rest of somebody's writing permanently, silently,
 * and with no way to tell from the file that anything is missing.
 */
export function buildGraphLogContent(input: {
  date: string;
  hash: string | null;
  body: string;
  incompleteReason?: string | null;
}): string {
  const frontmatter = stringifyYaml({
    date: input.date,
    ...(input.hash ? { sourceHash: input.hash } : {}),
    ...(input.incompleteReason ? { incomplete: input.incompleteReason } : {}),
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body.trim()}\n`;
}

type GraphCandidate = {
  fileId: string;
  name: string;
  date: string;
  contentHash: string | null;
  folderId: string;
};

/** Walks a project's `syncs/` tree recursively, collecting every file
 * that carries a `date` — skipping `_knowledge/` folders (their own
 * contents are read as a CANDIDATE's sidecar, never a candidate in their
 * own right). A file with no `date` set isn't supported yet (today, only
 * `daily-log-sync`'s own output stamps one) — silently excluded, not an
 * error. */
async function collectDatedCandidates(humanId: string, folderId: string): Promise<GraphCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: GraphCandidate[] = files
    .filter((f) => !!f.date)
    .map((f) => ({ fileId: f._id, name: f.name, date: f.date!, contentHash: f.content_hash ?? null, folderId }));
  for (const sub of folders) {
    if (sub.name === KNOWLEDGE_FOLDER_NAME) continue;
    out.push(...(await collectDatedCandidates(humanId, sub._id)));
  }
  return out;
}

/** A candidate's contributor + (for an attachment) its human-friendly
 * original name -- tries the Card-text shape first
 * (`date-humanId.md`), then the attachment shape (`date-humanId-
 * originalName`); the two are mutually exclusive by construction (see
 * `parseSyncedAttachmentFileName`'s own doc). Neither matching means an
 * unrecognized file shape (a future non-daily-log sync source) -- no
 * attribution available, not an error. */
type CandidateAttribution = { humanId?: string; originalName?: string; isAttachment: boolean };

function resolveCandidateAttribution(name: string): CandidateAttribution {
  const asCard = parseSyncedCardFileName(name);
  if (asCard) return { humanId: asCard.humanId, isAttachment: false };
  const asAttachment = parseSyncedAttachmentFileName(name);
  if (asAttachment) {
    return { humanId: asAttachment.humanId, originalName: asAttachment.originalName, isAttachment: true };
  }
  return { isAttachment: false };
}

/** Finds a candidate's own sibling knowledge sidecar (`_knowledge/<name>.knowledge.md`
 * next to it), if `sync-knowledge` has already produced one — see that
 * stage's own module doc for the naming convention. */
async function findKnowledgeSidecar(
  humanId: string,
  candidate: GraphCandidate,
): Promise<{ fileId: string; contentHash: string | null } | null> {
  const { folders } = await listFolderChildren(humanId, candidate.folderId);
  const knowledgeFolder = folders.find((f) => f.name === KNOWLEDGE_FOLDER_NAME);
  if (!knowledgeFolder) return null;
  const dot = candidate.name.lastIndexOf(".");
  const base = dot > 0 ? candidate.name.slice(0, dot) : candidate.name;
  const sidecarName = `${base}.knowledge.md`;
  const { files } = await listFolderChildren(humanId, knowledgeFolder._id);
  const listing = files.find((f) => f.name === sidecarName);
  return listing ? { fileId: listing._id, contentHash: listing.content_hash ?? null } : null;
}

function aggregateHash(parts: string[]): string {
  return createHash("sha256").update([...parts].sort().join("|")).digest("hex").slice(0, 16);
}

// ─── Backward-link candidate ids — deterministic, parsed the same
// simple-regex way `graphStructure.server.ts`'s own parsing does ────────

const STRUCTURE_NODE_LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s+Node\s+(\d+)\b/;
const HEADING_NODE_NUMBER_RE = /^Node\s+(\d+)$/;

/** Scans `graph-structure.md`'s raw body (any cluster) for every
 * `- <date> Node <N> ...` line and returns a `date#number -> display
 * label` map — used only to VALIDATE a day's `backwardLinks`, not a real
 * parse of that file's structure (that's `graphStructure.server.ts`'s own
 * job). */
function extractStructureNodeIds(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const match = STRUCTURE_NODE_LINE_RE.exec(trimmed);
    if (match) map.set(`${match[1]}#${Number(match[2])}`, trimmed.replace(/^-\s*/, ""));
  }
  return map;
}

/** Same shape as `extractStructureNodeIds`, but over `headingsByDate`'s
 * live/fallback heading lists (see `runSyncGraph`'s own module doc on
 * when each source is used). */
function headingsByDateToIds(headingsByDate: Map<string, NodeHeading[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [date, headings] of headingsByDate) {
    for (const h of headings) {
      const match = HEADING_NODE_NUMBER_RE.exec(h.heading);
      if (!match) continue;
      map.set(`${date}#${Number(match[1])}`, `${date} ${h.heading}`);
    }
  }
  return map;
}

// ─── The per-day add_node tool-calling loop ────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "add_node",
    description:
      'Add one citable node to today\'s graph-log file. Call this AT MOST ONCE per turn, then stop and wait for the result before calling it again for the next node -- if you call it more than once in the same turn, only the first call is processed and the rest are rejected (you will need to call them again on a later turn). `sourceIndex` must be one of today\'s numbered sources (shown as "Source 0:", "Source 1:", etc) -- its citation is attached automatically from real data, never write a :ref{...} yourself. A source marked as an ATTACHED FILE (a photo, a video, a PDF, ...) is real content just like any text source -- it may show you a Caption (the uploader\'s own words, zero AI) and/or a Description (an earlier pass\'s writeup of what the file shows); either alone is enough to cite, and a caption is the more authoritative of the two when both are present. The actual file is attached to the node automatically (a photo or video embeds inline, anything else becomes a link), you never write any markup to attach it yourself. `blocks` is the verbatim words (or, for a file source, your own words grounded in whatever Caption/Description text you were actually given), broken into one or more paragraph/list blocks in order -- code applies ==...== highlighting itself (per-item for a list, so a marker never ends up inside the highlight, and per-paragraph, so a highlight never spans a blank line and breaks) -- never include == yourself. `sameDayLinks`/`backwardLinks` are optional -- at most 3 links total are kept (any more, or any id you weren\'t actually given as a candidate, are dropped and reported back to you), so only send the ones that matter most.',
    inputSchema: {
      type: "object",
      properties: {
        sourceIndex: { type: "number" },
        setup: {
          type: "string",
          description: "Optional short scaffolding clause BEFORE the verbatim words, only when needed to make the quote standalone. Never highlighted -- add as little as possible, most nodes need none.",
        },
        blocks: {
          type: "array",
          description: 'The verbatim words, in order. Use a "list" block for anything that was a numbered/bulleted list OR an indented/nested outline in the source -- never reproduce indentation as literal leading spaces (it renders as a broken code block).',
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["paragraph", "list"] },
              text: { type: "string", description: 'Required for a "paragraph" block -- one verbatim paragraph, no leading indentation.' },
              items: {
                type: "array",
                items: { type: "string" },
                description: 'Required for a "list" block -- one verbatim string per item, WITHOUT its own "1."/"-" marker (code adds that).',
              },
              ordered: { type: "boolean", description: 'For a "list" block only -- true for a numbered list, omit/false for a bulleted one.' },
            },
            required: ["type"],
          },
        },
        sameDayLinks: {
          type: "array",
          items: { type: "number" },
          description: "Node numbers you already added earlier this same day/turn.",
        },
        backwardLinks: {
          type: "array",
          items: { type: "string" },
          description: 'Ids of earlier days\' nodes, e.g. "2026-07-29#3" -- from the candidates you were shown.',
        },
      },
      required: ["sourceIndex", "blocks"],
    },
  },
];

/** Renders `add_node`'s own `blocks` parameter into the final `==...==`-
 * marked markdown, entirely in code -- the model never writes `==` itself
 * (see the header's "real architecture change" note: a real, confirmed
 * rendering bug came from the model wrapping a whole multi-paragraph/
 * indented passage in ONE `==...==` span, which CommonMark's inline
 * markup can never cross a blank line to close correctly). A "paragraph"
 * block becomes one `==text==`; a "list" block becomes one highlighted
 * item per entry, with its own `-`/`N.` marker kept OUTSIDE the highlight
 * (matching `GRAPH.md`'s own long-standing instruction for lists, now
 * structurally guaranteed instead of merely requested). Blocks are joined
 * with a blank line, since separate `==...==` spans are exactly how a
 * multi-paragraph verbatim passage must be represented at all. */
function renderQuoteBlocks(rawBlocks: unknown, highlight: boolean = true): string | null {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return null;
  const mark = (text: string) => (highlight ? `==${text}==` : text);
  const parts: string[] = [];
  for (const raw of rawBlocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    if (block.type === "paragraph") {
      const text = String(block.text ?? "").trim();
      if (text) parts.push(mark(text));
    } else if (block.type === "list") {
      const items = Array.isArray(block.items)
        ? block.items.map((i) => String(i).trim()).filter(Boolean)
        : [];
      if (items.length === 0) continue;
      const ordered = block.ordered === true;
      parts.push(items.map((item, i) => `${ordered ? `${i + 1}.` : "-"} ${mark(item)}`).join("\n"));
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * `==` MEANS A PERSON WROTE THIS, AND CODE DECIDES IT (ADR-012).
 *
 * For a text source, `blocks` are somebody's verbatim words and the
 * highlight is simply true. Attachments broke that: for a file source the
 * skill asks for "your own words grounded in whatever Caption/Description
 * text you were actually given", and the code then applied `==` the same
 * way regardless. A photo with a human caption is still a person talking.
 * A photo with only a machine-written description produces AI prose
 * wearing the one mark in this system that means verbatim human words.
 *
 * That is the failure that costs trust rather than accuracy. A reader who
 * finds one quotation attributed to a colleague who never wrote it starts
 * doubting every other quotation on the page, and that does not recover.
 *
 * Not captioning a photo must not cost somebody their content, so the node
 * is still written, still linkable, still groupable. It just must not be
 * quotable as a person.
 *
 * ADR-012 (docs/adr/0012-highlight-means-a-person-wrote-this.md, kept out of the public repo).
 */
function isHumanAuthoredSource(fileInfo: SourceFileInfo | null): boolean {
  // A text source (not an attachment) is the person's own writing.
  if (!fileInfo) return true;
  // An attachment counts when the uploader wrote a caption -- their own
  // words, zero AI, deliberately independent of whether sync-knowledge
  // ever ran.
  return !!fileInfo.caption?.trim();
}

/** Written by code into the node's own permanent text, never by the model
 * and never as an instruction it has to remember. The fact travels with
 * the node forever, so every later stage and every human reader sees it
 * without needing to have been told the rule. */
const DESCRIPTION_ONLY_PROVENANCE =
  "*Written from an AI description of this file. Not a quotation, and not anyone's words.*";

type SourceFileInfo = { fileId: string; name: string; caption?: string; contentType: string };

/** Escapes characters that would otherwise break markdown image/link
 * syntax if they showed up in a filename or a human-written caption --
 * substitution, not a real escape (no markdown syntax lets `[`/`]` occur
 * literally inside alt text at all), same "substitute, don't pretend to
 * escape" approach `refDirective.ts`'s own `escapeDirectiveAttrValue`
 * already takes for `:ref{...}`'s attribute values. */
function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/[[\]]/g, "");
}

/** An attached file's own markdown, appended to its node's text when
 * `add_node` cites a file-backed source -- shape depends on the file's
 * real content type, decided here by CODE, never left for the model to
 * guess at:
 *
 * - An IMAGE is an ORDINARY \`![alt](url)\` markdown image.
 * - A VIDEO is an ORDINARY \`[alt](url)\` markdown LINK, its URL carrying
 *   \`?type=video\` -- a real, working, clickable link even in a renderer
 *   that's never heard of this convention (unlike an image tag pointed at
 *   a video file, which would just be broken), and the SAME marker
 *   `OxRenderer.tsx`'s own gallery collector looks for to upgrade it into
 *   a real `<video controls>` player when it appears inside a
 *   `:::gallery{}...:::` block.
 * - ANYTHING ELSE (a PDF, a doc, ...) is a plain \`[name](url)\` link, no
 *   marker -- never embedded as media, never gallery-eligible; a reader
 *   just clicks through to it. GRAPH_STRUCTURE.md/PROJECT_VIEW.md both
 *   say the same thing from the model's side: a gallery holds photos and
 *   videos only, everything else is an ordinary link.
 *
 * The caption (a human's own words, when present) becomes the alt/link
 * text either way, which is also what a `:::gallery{}...:::` grid shows
 * as a caption underneath a photo or video -- falls back to the file's
 * own name when there is none. */
function buildAttachedMediaMarkdown(info: SourceFileInfo): string {
  const alt = escapeMarkdownImageAlt(info.caption || info.name);
  const url = `/api/vault/view/${info.fileId}`;
  if (info.contentType.startsWith("image/")) return `![${alt}](${url})`;
  if (info.contentType.startsWith("video/")) return `[${alt}](${url}?type=video)`;
  return `[${alt}](${url})`;
}

// brake, not a default — see ADR-002 (docs/adr/0002-three-link-cap-per-node.md,
// kept out of the public repo). Links create weight, weight creates
// visibility, visibility creates writing, and writing creates links --
// this caps that loop so whatever's already been mentioned most can't
// accumulate faster forever. Reads as an arbitrary tuning constant;
// raising it looks free right up until the top of every project's index
// stops changing. If this ever needs to change, that's a conversation,
// not a one-line tweak -- see the ADR for what "how you'd know it broke"
// looks like (nothing errors, the graph just slowly starts amplifying
// whatever got mentioned most).
export const MAX_LINKS_PER_NODE = 3;

/** Pure cap logic, split out from the \`add_node\` executor purely so
 * ADR-002's own "no node ends up with four links" test can exercise it
 * directly. Same-day links are kept first (see the caller's own comment
 * for why). */
export function capNodeLinks(
  sameDay: number[],
  backward: string[],
  max: number = MAX_LINKS_PER_NODE,
): { sameDay: number[]; backward: string[]; droppedCount: number } {
  const cappedSameDay = sameDay.slice(0, max);
  const cappedBackward = backward.slice(0, Math.max(0, max - cappedSameDay.length));
  const droppedCount = sameDay.length + backward.length - cappedSameDay.length - cappedBackward.length;
  return { sameDay: cappedSameDay, backward: cappedBackward, droppedCount };
}

function createSyncGraphExecutors(input: {
  date: string;
  sourceCitations: string[];
  sourceFiles: (SourceFileInfo | null)[];
  knownBackwardIds: Map<string, string>;
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  getNodeBlocks: () => string[];
  /** One short line per node captured for this day SO FAR, across every
   * pass. Fed back into the next pass's own prompt so it can see what
   * today already holds and not re-capture it -- the mechanism that makes
   * a day safe to split across several conversations. */
  getCapturedSummaries: () => string[];
} {
  const nodeBlocks: string[] = [];
  const capturedSummaries: string[] = [];
  let nextNumber = 1;

  const executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>> = {
    add_node: async (toolInput) => {
      const sourceIndex = Number(toolInput.sourceIndex);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= input.sourceCitations.length) {
        return `Error: sourceIndex must be an integer between 0 and ${input.sourceCitations.length - 1}`;
      }
      // ADR-012: whether this node's text is somebody's words is decided
      // HERE, from the source, before the model's blocks are rendered.
      // The model is never asked to know or remember it.
      const fileInfo = input.sourceFiles[sourceIndex];
      const humanAuthored = isHumanAuthoredSource(fileInfo);
      const quoteBody = renderQuoteBlocks(toolInput.blocks, humanAuthored);
      if (!quoteBody) return "Error: blocks must include at least one non-empty paragraph or list block";
      const setup = typeof toolInput.setup === "string" ? toolInput.setup.trim() : "";
      // If this node cites an ATTACHED FILE (a photo, a video, a PDF,
      // ...), its markdown is appended here BY CODE (image/video/plain
      // link, shaped by the file's real content type), never typed out
      // by the model -- same "never trust the model with markup it can
      // get wrong" reasoning \`:ref{...}\`'s own citation already
      // follows. This is also the whole fix for "files never showed up
      // in the README": from here on, a node about a photo carries that
      // photo inline in its own permanent text, so every later stage
      // (graph-structure's pre-fetch, graph-project-view) sees it
      // automatically.
      const attachedMedia = fileInfo ? buildAttachedMediaMarkdown(fileInfo) : null;
      const quote = [
        setup || null,
        quoteBody,
        humanAuthored ? null : DESCRIPTION_ONLY_PROVENANCE,
        attachedMedia,
      ]
        .filter(Boolean)
        .join("\n\n");

      const number = nextNumber;
      const rawSameDay = Array.isArray(toolInput.sameDayLinks) ? toolInput.sameDayLinks : [];
      const validSameDay = rawSameDay
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n < number);
      const rawBackward = Array.isArray(toolInput.backwardLinks) ? toolInput.backwardLinks : [];
      const validBackward = rawBackward.map((id) => String(id)).filter((id) => input.knownBackwardIds.has(id));
      const invalidCount =
        rawSameDay.length - validSameDay.length + (rawBackward.length - validBackward.length);

      // A node may link to at most MAX_LINKS_PER_NODE others (per GRAPH.md's
      // own instructions) -- enforced here rather than left as a soft
      // instruction, same "never trust the model with a rule code can
      // just apply" reasoning the rest of this pipeline already follows.
      // Same-day links are kept first (they're rarer and more deliberate
      // -- a cross-day link is comparatively easy to over-produce).
      const { sameDay: sameDayNumbers, backward: backwardIds, droppedCount: overCapCount } = capNodeLinks(
        validSameDay,
        validBackward,
      );
      const droppedCount = invalidCount + overCapCount;

      const linkLines = [
        ...sameDayNumbers.map((n) => `- [${input.date} Node ${n}](./${graphLogFileName(input.date)}#node-${n})`),
        ...backwardIds.map((id) => {
          const [date, num] = id.split("#");
          return `- [${date} Node ${num}](./${graphLogFileName(date)}#node-${num})`;
        }),
      ];

      nodeBlocks.push(
        [
          `### Node ${number}`,
          quote,
          input.sourceCitations[sourceIndex],
          linkLines.length > 0 ? linkLines.join("\n") : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      // Enough for a later pass to recognize this node as already
      // captured without re-reading its whole text. Deliberately the
      // node's own words rather than a paraphrase: the next pass is
      // comparing against the same sources this one read.
      const preview = quoteBody.replace(/\s+/g, " ").replace(/==/g, "").trim().slice(0, 160);
      capturedSummaries.push(`Node ${number} (from Source ${sourceIndex}): "${preview}"`);
      nextNumber++;

      return `Added Node ${number}.${humanAuthored ? "" : " (written UNHIGHLIGHTED and marked as description-grounded -- this source has no human caption, so its text is not anyone's words and must never be quoted or attributed to a person)"}${droppedCount > 0 ? ` (dropped ${droppedCount} link id(s) -- invalid, or over the ${MAX_LINKS_PER_NODE}-link cap)` : ""}`;
    },
  };

  return { executors, getNodeBlocks: () => nodeBlocks, getCapturedSummaries: () => capturedSummaries };
}

/**
 * BOUNDS ONE PASS, NOT ONE DAY. This is the distinction ADR-013 exists
 * for, and getting it wrong is what made a busy day permanently
 * unwritable.
 *
 * With one `add_node` executed per turn, this number and "how many nodes
 * a day may hold" used to be the same number. A runaway-loop guard had
 * quietly become a data ceiling at about 29 nodes, and a day that reached
 * it had every one of its nodes discarded, with a log line promising a
 * retry that would fail identically forever. Run 16's own timeline shows
 * how close that was: 2026-08-19 took six turns for five nodes, so two
 * people writing normally reached seventeen and three reached the wall.
 *
 * A day is now a sequence of passes (`MAX_PASSES_PER_DAY`), each a fresh
 * conversation, each committing what it captured before the next starts.
 * This bounds one of those. A day that needs more nodes than one pass can
 * hold simply takes another pass.
 *
 * ADR-013 (docs/adr/0013-turn-limit-never-the-content-limit.md, kept out of the public repo).
 *
 * Do NOT "fix" a future ceiling by raising this. Raising it moves the
 * cliff without removing it, and a cliff hit once a year is worse than one
 * hit weekly, because nobody remembers it exists.
 */
const MAX_TURNS = 30;

/**
 * A runaway guard on the pass loop, never the content limit.
 *
 * The loop's real terminator is a pass that adds nothing new, which is the
 * model saying these sources are exhausted. This exists only so a model
 * that keeps finding "one more node" forever cannot spend without bound.
 * At ~29 nodes a pass it allows a single day far past anything a human
 * team produces, so in practice it should never be what stops a day.
 *
 * If it ever IS hit, the day is still written with everything captured and
 * the shortfall is reported. It is not another discard path.
 */
const MAX_PASSES_PER_DAY = 8;

/** What one pass's ending means for the day as a whole.
 *
 * Split out from the loop (same reason, and the same precedent, as
 * `capNodeLinks`) because this is the judgment that decides whether a
 * person's day is recorded as finished or as partial, and it has four
 * cases that are easy to collapse into two by accident:
 *
 *   - added > 0                  -> keep going, the pass was productive.
 *   - added 0, ended cleanly     -> DONE. The model has nothing left to
 *                                   take from these sources. This is the
 *                                   loop's real terminator.
 *   - added 0, ended badly       -> STUCK. Another identical pass would
 *                                   fail identically. Stop and report.
 *   - productive at the cap      -> the cap itself is the shortfall.
 *
 * The two `added === 0` cases are the ones that must not merge: one is a
 * successful day and the other is a truncated one, and they look the same
 * from the outside (a pass that captured nothing).
 */
export function classifyPassEnding(input: {
  added: number;
  truncated: boolean;
  hitMaxTurns: boolean;
  passesCompleted: number;
  maxPasses: number;
  maxTurns: number;
}): { stop: boolean; shortfall: string | null } {
  if (input.added > 0) {
    // Productive. Only the cap can stop us here, and if it does, the cap
    // is the shortfall -- there was more to capture.
    if (input.passesCompleted >= input.maxPasses) {
      return { stop: true, shortfall: `still finding new nodes after ${input.maxPasses} passes` };
    }
    return { stop: false, shortfall: null };
  }
  if (input.truncated) {
    return {
      stop: true,
      shortfall: "a pass was cut off by the model's own output limit before capturing anything",
    };
  }
  if (input.hitMaxTurns) {
    return {
      stop: true,
      shortfall: `a pass hit its ${input.maxTurns}-turn limit before capturing anything`,
    };
  }
  return { stop: true, shortfall: null };
}

async function runSyncGraphDayLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  callCounter: { count: number },
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  perf: GraphLogPerfRecorder,
  date: string,
  projectFolderId: string,
  pass: number,
): Promise<{ usage: LlmUsage; model: string | null; truncated: boolean; hitMaxTurns: boolean }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per turn, so a Stop request never
    // waits longer than the current tool call.
    await throwIfGraphLogCancelled(projectFolderId);
    // The system prompt (skill instructions + graph-structure.md) is
    // byte-identical across every day AND every turn of this whole run —
    // see this file's own "Prompt caching" module doc. The FIRST ever
    // completion in the run doesn't yet know if there'll be a second one
    // worth reading the cache back for; every one after does.
    const cacheSystemPrompt = callCounter.count > 0;
    const turnStart = Date.now();
    const response = await provider.complete({ system, messages, tools: TOOLS, cacheSystemPrompt });
    callCounter.count++;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    // Cache counts come back on EVERY response and were being dropped on
    // the floor right here, in all three agent loops -- which is the
    // whole reason the dashboard read a 0% cache hit rate across every
    // call ever made. Nothing else in the path was wrong: the provider
    // marks the blocks, `LlmUsage` carries the fields, the table has both
    // columns, the daily rollup sums them and the UI renders them. They
    // just never got added up, so `recordGraphLogUsage` saw undefined and
    // stored zero. This also makes `estimatedCostUsd` right for the first
    // time -- cached reads and writes are priced differently from plain
    // input tokens (`llmPricing.ts`), so a run with real cache traffic
    // was being costed as if it had none.
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (response.usage.cacheReadTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0);
    model = response.model;

    // One perf event PER TURN (a real, individually-timed API call),
    // nested (by actual start time) under this day's own aggregate event
    // recorded by the caller -- includes whatever plain text the model
    // wrote alongside/instead of a tool call this turn, thrown away
    // everywhere else in this loop (only ever fed back into `messages`,
    // never persisted) but genuinely useful here: it's exactly what a
    // truncated turn was in the middle of writing when it got cut off.
    await perf.event({
      process: "sync-graph",
      type: "llm",
      name: "turn",
      params: {
        date,
        pass: pass + 1,
        turn: turn + 1,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls.map((c) => c.name),
        text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
      },
      durationMs: Date.now() - turnStart,
      outcome: response.stopReason === "max_tokens" ? "error" : "ok",
    });

    if (response.stopReason === "max_tokens") {
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    // A REAL, CONFIRMED BUG (found against a real production run, not
    // theoretical): this loop's own module doc has always claimed "each
    // turn's own output is small (one node)", but nothing here actually
    // enforced that -- Anthropic is free to return MULTIPLE `tool_use`
    // blocks in a single response, and on a busy day the model batched
    // several `add_node` calls into one turn, which grew that turn's own
    // generated output past the shared 8192-token ceiling -- the exact
    // truncation class this stage's whole redesign was meant to make
    // unreachable, just recreated one level up (per-turn instead of
    // per-day). The system prompt/tool description now also ASK for one
    // call per turn, but a prompt alone is never trusted here (same
    // reasoning every other "never trust the model with something code
    // can just enforce" fix in this file already follows) -- only the
    // FIRST tool call in a turn is actually executed; every extra call in
    // that SAME turn is rejected without being applied, so the model
    // simply re-issues it on a later turn instead of it silently
    // succeeding twice or being dropped.
    // `add_node` is this stage's only tool and it is a write, so every
    // call here is throttled. Routed through the shared helper anyway:
    // this is the same invariant `graph-structure` and `graph-project-view`
    // now enforce, it was found here first, and three copies of one rule
    // is how the rule drifts. See `planTurnToolCalls` for the full why.
    for (const { call, execute } of planTurnToolCalls(response.toolCalls, () => true)) {
      const resultText = execute
        ? ((await executors[call.name]?.(call.input)) ?? `Unknown tool: ${call.name}`)
        : "Not processed -- only the FIRST add_node call in a turn is executed, to keep each turn's own output small. Call add_node again on your next turn for this node.";
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns };
}

function buildSystemPrompt(skillContent: string, graphStructureBody: string | null): string {
  const structureSection = graphStructureBody
    ? `The graph's existing nodes, organized and glossed (from graph-structure.md, current as of its own last run — every "<date> Node <N>" you see here is a valid backwardLinks id, as "date#N"):\n\n${graphStructureBody}`
    : "No graph-structure.md exists yet for this project — see the plain candidate list you're given per day instead.";
  return `You are GraphLog's sync-graph step, extracting citable nodes from one day's synced content at a time, per a project owner's own instructions. Call add_node once per node worth capturing today, citing it by its sourceIndex — never write a :ref{...} yourself, it's attached automatically from real data. Call add_node ONE TIME PER TURN, then stop and wait for its result before calling it again for the next node — never call add_node more than once in the same response, even on a busy day with many nodes to add; only your first call each turn is actually processed, any extra calls in the same turn are rejected and must be retried on a later turn. Only use sameDayLinks/backwardLinks ids you were actually shown as candidates; an invented one is silently dropped and reported back to you. Stop calling add_node once you've captured everything worth capturing today — if nothing from today is worth capturing at all, make no tool calls.\n\n${skillContent}\n\n---\n\n${structureSection}`;
}

function buildUserPrompt(input: {
  date: string;
  sourceBlocks: string[];
  liveCandidates: string[];
  /** Empty on a day's first pass. On later passes, one line per node
   * already captured today -- see `MAX_PASSES_PER_DAY` for why a day is a
   * sequence of passes rather than one conversation. */
  alreadyCaptured: string[];
}): string {
  return [
    `Today's date being processed: ${input.date}`,
    input.sourceBlocks.join("\n\n---\n\n"),
    input.liveCandidates.length > 0
      ? `Earlier days' nodes not yet reflected in graph-structure.md, which you may also link back to by id (never invent one not listed here):\n${input.liveCandidates.map((c) => `- ${c}`).join("\n")}`
      : null,
    "You may also link a node to another node you add earlier this same day, in either direction, via sameDayLinks.",
    // Deliberately LAST, so everything above it is byte-identical across
    // every pass of one day. Nothing reads that property yet -- each pass
    // is a fresh conversation and only turn 2+ of a conversation gets a
    // message-level cache breakpoint today -- but it means caching the
    // shared prefix across passes later is a provider change alone,
    // rather than also a prompt-ordering change. See 1.7: a multi-pass day
    // re-sends its sources once per pass, and that is exactly the cost
    // curve worth measuring before optimizing.
    input.alreadyCaptured.length > 0
      ? `ALREADY CAPTURED FOR THIS DAY by an earlier pass over these same sources -- ${input.alreadyCaptured.length} node(s). These are written and permanent. Do NOT add them again, and do not rephrase them into new nodes. Add ONLY what these same sources still hold that is not represented above. If everything worth capturing today is already here, make no tool calls at all:\n${input.alreadyCaptured.map((c) => `- ${c}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export type SyncGraphDayResult = {
  date: string;
  /** True when a day's graph-log file was newly written or regenerated
   * this run; false when an already-up-to-date one was found and left
   * untouched. */
  changed: boolean;
  /** True when the model decided this day had nothing worth capturing —
   * no `graph-log-*.md` file exists for it (possibly because a PREVIOUS
   * file for this exact day was just deleted, if its sources changed). */
  empty: boolean;
  /** How many nodes this day's file ended up holding. 0 for an empty or
   * unchanged day. One half of 1.7's cost-per-node denominator: the run
   * timeline already implied this number and nothing stored it. */
  nodes: number;
  /** How many passes this day took. A day that needed more than one is a
   * day the old single-conversation shape would have been at risk of
   * discarding, so this is worth watching directly. */
  passes: number;
};

export type SyncGraphResult =
  | {
      ok: true;
      /** True when `skills/GRAPH.md` is missing or says "skip" — a total
       * no-op, no files examined, no model called. */
      skipped: boolean;
      days: SyncGraphDayResult[];
      /** Total nodes written across every day this run. */
      nodesWritten: number;
      /** Reasons this stage finished WITHOUT doing everything it set out
       * to, one human-readable line each; empty when it finished clean.
       *
       * `ok: true` here means "nothing threw and whatever was captured is
       * safely committed", NOT "the stage did its whole job". Those came
       * apart in a real run: a truncated batch left this stage's own work
       * half-done and its downstream stage producing nothing, and the run
       * still reported OK at the top. A partial result that says it is
       * partial is fine (ADR-011 -- a budget bounds how late the derived
       * layer runs, never what is kept); a partial result that reports
       * itself as complete is not. `graphLogAgent.server.ts` collects
       * these across all five stages so the run's own status can say so.
       *
       * Deliberately NOT `ok: false`: every case here is resumable, made
       * real progress, and is picked up by the next run. Failing the job
       * outright would discard that progress in the reporting and invite
       * a retry of work that already landed. */
      incomplete: string[];
    }
  | { ok: false; error: string };

export interface RunSyncGraphOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. */
  perf?: GraphLogPerfRecorder;
}

/**
 * Runs sync-graph for one project. Sweeps every day with a dated
 * candidate under `syncs/`, oldest first, so a later day's cross-links
 * can always point at an already-processed earlier day within the same
 * run.
 */
export async function runSyncGraph(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunSyncGraphOptions = {},
): Promise<SyncGraphResult> {
  const log = opts.log ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const skill = await getProjectStageSkill(projectFolder, "GRAPH.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, days: [], nodesWritten: 0, incomplete: [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) {
    log("sync-graph: no syncs/ folder yet — nothing to do.");
    return { ok: true, skipped: false, days: [], nodesWritten: 0, incomplete: [] };
  }

  const candidates = await collectDatedCandidates(projectFolder.human_id, syncsFolder._id);
  if (candidates.length === 0) {
    log("sync-graph: no dated files under syncs/ yet — nothing to do.");
    return { ok: true, skipped: false, days: [], nodesWritten: 0, incomplete: [] };
  }

  const byDate = new Map<string, GraphCandidate[]>();
  for (const c of candidates) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const dates = [...byDate.keys()].sort();

  // Resolve every possible contributor's display name up front, one
  // batched lookup — `resolveCandidateAttribution` returns nothing for
  // anything not shaped like a daily-log-sync copy (a future non-daily-
  // log sync source's own file), which just means no attribution name is
  // available for it below.
  const contributorIds = new Set<string>();
  for (const c of candidates) {
    const attribution = resolveCandidateAttribution(c.name);
    if (attribution.humanId) contributorIds.add(attribution.humanId);
  }
  const humans = await getHumansById([...contributorIds]);
  const humanNameById = new Map(humans.map((h) => [h._id, h.name]));

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");

  // `graph-structure.md` (if it exists) is the PRIMARY source for "nodes
  // from a previous run you may link back to" -- a real, glossed,
  // weighted index instead of a bare `[date Node N](...)` link list with
  // nothing to judge relevance against (see `graphStructure.server.ts`'s
  // own module doc). It's necessarily ONE CYCLE STALE -- reflects the
  // graph as of the last time graph-structure ran, not this exact moment
  // -- which is fine in practice since `nopal graphlog run` always runs
  // graph-structure immediately after sync-graph. It's folded into the
  // CACHED system prompt below (see this file's own "Prompt caching"
  // module doc) since it's stable across every day this run touches.
  //
  // `headingsByDate` stays for two jobs now: (1) nodes written EARLIER IN
  // THIS SAME RUN, which graph-structure.md can never reflect yet (it
  // hasn't regenerated) — shown to the model per day as a plain
  // additional candidate list; (2) a project that's never had
  // graph-structure run at all falls back to scanning every existing
  // graph-log file's headings, so early history isn't invisible.
  const existingGraphFolder = await findProjectGraphFolder(projectFolder);
  let graphStructureBody: string | null = null;
  const headingsByDate = new Map<string, NodeHeading[]>();
  if (existingGraphFolder) {
    const { files: existingFiles } = await listFolderChildren(
      projectFolder.human_id,
      existingGraphFolder._id,
    );
    const structureListing = existingFiles.find((f) => f.name === "graph-structure.md");
    const structureFile = structureListing ? await getFileRefById(structureListing._id) : undefined;
    graphStructureBody = structureFile?.content ? splitFrontmatter(structureFile.content).body.trim() : null;

    if (!graphStructureBody) {
      for (const f of existingFiles) {
        const date = dateFromGraphLogFileName(f.name);
        if (!date) continue;
        const full = await getFileRefById(f._id);
        if (full?.content) headingsByDate.set(date, extractHeadings(full.content));
      }
    }
  }
  const structureIds = graphStructureBody ? extractStructureNodeIds(graphStructureBody) : new Map<string, string>();
  const system = buildSystemPrompt(skillContent, graphStructureBody);

  let textLlm: LlmProvider | undefined = opts.provider;
  const callCounter = { count: 0 };
  const days: SyncGraphDayResult[] = [];
  // One line per day this run failed to capture. Every entry here is a
  // day whose nodes were DISCARDED WHOLE (see the truncated/hitMaxTurns
  // branches below), which is the single most consequential thing this
  // pipeline can do wrong -- it is somebody's actual writing, and the
  // log line has always said "will retry next run" about something that
  // retries identically and fails identically. Until that is properly
  // fixed (Part 0 / ADR-013: a day becomes a loop of committing passes,
  // not one conversation), the very least this owes the run is to stop
  // reporting OK while it happens.
  const incomplete: string[] = [];

  for (const date of dates) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per day, so a Stop request never
    // waits longer than the current day's own extraction turns.
    await throwIfGraphLogCancelled(projectFolder._id);

    const dayCandidates = byDate.get(date)!;

    // A human can write a real caption on a `::file{...}` attachment
    // right in the Card itself (see `oxmarkdown/fileDirective.ts`'s own
    // caption editor) -- their OWN words about the file, zero AI
    // involved, and available even when sync-knowledge is "skip". It
    // lives on the CARD's markdown, never on the copied attachment file
    // itself, so it's recovered here by re-reading each of today's Card
    // candidates and matching by the attachment's own synced name.
    const captionByAttachmentName = new Map<string, string>();
    for (const candidate of dayCandidates) {
      const asCard = parseSyncedCardFileName(candidate.name);
      if (!asCard) continue;
      const cardFile = await getFileRefById(candidate.fileId);
      if (!cardFile?.content) continue;
      for (const attachment of extractFileAttachments(cardFile.content)) {
        if (!attachment.caption) continue;
        captionByAttachmentName.set(
          syncedAttachmentFileName(asCard.date, asCard.humanId, attachment.name),
          attachment.caption,
        );
      }
    }

    const hashParts: string[] = [];
    const sourceBlocks: string[] = [];
    const sourceCitations: string[] = [];
    // Parallel to `sourceCitations` -- non-null exactly when that source
    // IS an attached file (a photo, a PDF, ...), never a Card's own text.
    // `add_node`'s executor uses this to attach the real image markdown
    // automatically, by code, whenever a node cites that source -- see
    // this file's own module doc (a real, confirmed gap: an attachment
    // previously had NO path into the graph at all, since it never
    // carried a `date` and was never offered as a source here).
    const sourceFiles: (SourceFileInfo | null)[] = [];
    for (const candidate of dayCandidates) {
      const source = await getFileRefById(candidate.fileId);
      if (!source) continue;

      const sidecar = await findKnowledgeSidecar(projectFolder.human_id, candidate);
      let knowledgeContent: string | null = null;
      if (sidecar) {
        const sidecarFile = await getFileRefById(sidecar.fileId);
        knowledgeContent = sidecarFile?.content ?? null;
      }

      const attribution = resolveCandidateAttribution(candidate.name);
      const caption = attribution.isAttachment ? captionByAttachmentName.get(candidate.name) ?? null : null;

      // An attached file with NEITHER a real caption NOR a knowledge-
      // derived description is nothing to ground a node in -- skip it as
      // a candidate entirely (never counted in the idempotency hash
      // either, so it starts contributing the FIRST run something real
      // exists for it). A caption alone is enough, deliberately: it's the
      // uploader's OWN words, zero AI required, and shouldn't need
      // sync-knowledge switched on just to be reachable -- see the
      // `graphlog` skill's own "Files" note on why AI description and a
      // human's own caption are treated as two independent, either-is-
      // enough sources of grounding. The Card's own text content is
      // never skipped this way.
      if (attribution.isAttachment && !knowledgeContent && !caption) continue;

      hashParts.push(`${candidate.fileId}:${candidate.contentHash ?? candidate.fileId}`);
      if (sidecar) hashParts.push(`${sidecar.fileId}:${sidecar.contentHash ?? sidecar.fileId}`);
      if (caption) hashParts.push(`caption:${candidate.fileId}:${caption}`);

      const contributorName = attribution.humanId
        ? humanNameById.get(attribution.humanId) ?? "Unknown"
        : "Unknown";
      const displayName = attribution.originalName ?? source.name;

      const sourceIndex = sourceBlocks.length;
      sourceCitations.push(
        buildRefDirectiveMarkdown({
          name: contributorName,
          humanId: attribution.humanId,
          datetime: `${date}T12:00:00Z`,
          location: `/fruits/vault?file=${source._id}`,
          verbose: true,
        }),
      );
      sourceFiles.push(
        attribution.isAttachment
          ? { fileId: source._id, name: displayName, caption: caption ?? undefined, contentType: source.content_type }
          : null,
      );
      sourceBlocks.push(
        [
          `Source ${sourceIndex}: "${displayName}" (by ${contributorName})${attribution.isAttachment ? " -- an ATTACHED FILE (photo/PDF/etc); its own bytes aren't shown to you, only what's below" : ""}`,
          caption ? `Caption written by the person who uploaded it: "${caption}"` : null,
          attribution.isAttachment
            ? knowledgeContent ? `AI-generated description:\n${knowledgeContent}` : (caption ? null : "(no description available)")
            : `Content:\n${source.content ?? "(no readable text content)"}`,
          !attribution.isAttachment && knowledgeContent ? `Extracted knowledge about this source:\n${knowledgeContent}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    const newHash = aggregateHash(hashParts);
    const existingListing = existingGraphFolder
      ? (await listFolderChildren(projectFolder.human_id, existingGraphFolder._id)).files.find(
          (f) => f.name === graphLogFileName(date),
        )
      : undefined;
    const existing = existingListing ? await getFileRefById(existingListing._id) : undefined;

    if (existing && existingSourceHash(existing.content) === newHash) {
      days.push({ date, changed: false, empty: false, nodes: 0, passes: 0 });
      continue;
    }

    if (existing) {
      await deleteFileRef(existing._id);
    }

    // Combine graph-structure.md's own ids with this run's own live/
    // fallback ones, restricted to STRICTLY earlier days — enforced here
    // via validation, not just instructed, unlike the original design.
    const liveIds = headingsByDateToIds(headingsByDate);
    const knownBackwardIds = new Map(
      [...structureIds, ...liveIds].filter(([id]) => id.split("#")[0] < date),
    );
    const liveCandidates = [...liveIds.entries()]
      .filter(([id]) => id.split("#")[0] < date)
      .map(([, label]) => label);

    // ONE SET OF EXECUTORS FOR THE WHOLE DAY, shared across every pass.
    // Node numbering (`nextNumber`) and the captured-node list live in
    // that closure, so pass 2 continues from Node 18 rather than
    // restarting at Node 1, and `sameDayLinks` validation still holds
    // across a pass boundary.
    const { executors, getNodeBlocks, getCapturedSummaries } = createSyncGraphExecutors({
      date,
      sourceCitations,
      sourceFiles,
      knownBackwardIds,
    });

    const callStart = Date.now();
    try {
      textLlm ??= new AnthropicProvider();

      // A DAY IS A LOOP OF PASSES, NOT ONE CONVERSATION.
      //
      // This is the whole Part 0 fix. Each pass is a fresh, small
      // conversation over the SAME sources, told what today already holds
      // so it doesn't repeat itself, and every node it captures is
      // committed into the shared executor state before the next pass
      // starts. The loop ends when a pass adds nothing new, which is the
      // model saying these sources are exhausted.
      //
      // There is no node ceiling left, only a cost curve. `MAX_TURNS`
      // bounds a pass, which is what a runaway-loop guard should bound
      // (ADR-013), and the day is bounded by the sources actually running
      // out rather than by a constant.
      //
      // Note what a pass hitting `MAX_TURNS` means now: it is a FULL pass,
      // the normal way a busy day proceeds, not a failure. It is only a
      // problem when a pass fills up having added nothing, which means it
      // is stuck rather than working.
      const dayUsage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
      let dayModel: string | null = null;
      let shortfall: string | null = null;
      let passes = 0;

      while (passes < MAX_PASSES_PER_DAY) {
        const before = getNodeBlocks().length;
        const passPrompt = buildUserPrompt({
          date,
          sourceBlocks,
          liveCandidates,
          alreadyCaptured: getCapturedSummaries(),
        });
        const { usage, model, truncated, hitMaxTurns } = await runSyncGraphDayLoop(
          textLlm,
          system,
          passPrompt,
          callCounter,
          executors,
          perf,
          date,
          projectFolder._id,
          passes,
        );
        passes++;
        dayUsage.inputTokens += usage.inputTokens;
        dayUsage.outputTokens += usage.outputTokens;
        dayUsage.cacheReadTokens = (dayUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0);
        dayUsage.cacheWriteTokens = (dayUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
        dayModel = model ?? dayModel;
        const ending = classifyPassEnding({
          added: getNodeBlocks().length - before,
          truncated,
          hitMaxTurns,
          passesCompleted: passes,
          maxPasses: MAX_PASSES_PER_DAY,
          maxTurns: MAX_TURNS,
        });
        shortfall = ending.shortfall;
        if (ending.stop) break;
      }

      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        model: dayModel ?? undefined,
        usage: dayUsage,
        durationMs,
        outcome: shortfall ? "error" : "success",
        errorKind: shortfall ? "incomplete" : undefined,
      });
      await perf.event({
        process: "sync-graph",
        type: "llm",
        name: "day",
        params: { date, passes, nodes: getNodeBlocks().length, shortfall },
        durationMs,
        outcome: shortfall ? "error" : "ok",
      });

      const nodeBlocks = getNodeBlocks();
      if (nodeBlocks.length === 0) {
        // Genuinely nothing to capture, or stuck before capturing
        // anything. Either way nothing is being thrown away here.
        if (shortfall) {
          incomplete.push(`${date} captured nothing: ${shortfall}`);
          log(`sync-graph: ${date} — ${shortfall}; nothing captured, will retry next run.`);
        } else {
          log(`sync-graph: ${date} — nothing worth capturing.`);
        }
        headingsByDate.delete(date);
        days.push({ date, changed: true, empty: true, nodes: 0, passes });
        continue;
      }

      // THE DAY IS WRITTEN WHETHER OR NOT IT FINISHED. A partial day is
      // written without its `sourceHash`, so the next run cannot mistake
      // it for complete and reprocesses it from source; the nodes captured
      // are permanent and usable downstream immediately. What must never
      // happen again is the old behaviour: `continue` before the write,
      // discarding every node of somebody's day, logged as a retry that
      // retried into the same wall forever.
      if (shortfall) {
        incomplete.push(
          `${date} written incomplete (${nodeBlocks.length} node(s) captured): ${shortfall}`,
        );
        log(
          `sync-graph: ${date} — ${shortfall}; wrote the ${nodeBlocks.length} node(s) captured, remainder picked up next run.`,
        );
      }

      const graphFolder = await ensureProjectGraphFolder(projectFolder);
      const content = buildGraphLogContent({
        date,
        hash: shortfall ? null : newHash,
        incompleteReason: shortfall,
        body: nodeBlocks.join("\n\n"),
      });
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: graphLogFileName(date),
        content,
        content_type: "text/markdown",
        folder_id: graphFolder._id,
      });
      if (!created) continue;

      headingsByDate.set(date, extractHeadings(content));
      log(
        `sync-graph: wrote ${graphLogFileName(date)} (${nodeBlocks.length} node(s) over ${passes} pass(es))${shortfall ? " — INCOMPLETE" : ""}.`,
      );
      days.push({ date, changed: true, empty: false, nodes: nodeBlocks.length, passes });
    } catch (err) {
      log(`sync-graph: ${date} couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        durationMs,
        outcome: "error",
        errorKind: classifyGraphLogError(err),
      });
      await perf.event({
        process: "sync-graph",
        type: "llm",
        name: "day",
        params: { date },
        durationMs,
        outcome: "error",
      });
    }
  }

  return {
    ok: true,
    skipped: false,
    days,
    nodesWritten: days.reduce((sum, d) => sum + d.nodes, 0),
    incomplete,
  };
}
