/**
 * `LlmProvider` (`llmProvider.ts`) implemented against Anthropic's Messages
 * API — shared by every GraphLog stage (see the `graphlog` skill).
 * Translates the generic message/tool shape both directions; no caller
 * ever touches the Anthropic SDK directly.
 *
 * PROMPT CACHING: on by default, no config flag -- see "Prompt caching"
 * above `toAnthropicSystem`/`withLastMessageCacheBreakpoint` for exactly
 * what gets marked and why. Negatives worth knowing: a cache WRITE costs
 * ~25% more than a normal input token for that prefix (only worth it if
 * something reads it back before the 5-minute idle TTL expires); a
 * changed prefix (e.g. editing CAPTURE.md/VOICE.md mid-run) simply
 * doesn't match the old cache and falls back to a normal-priced write,
 * no penalty beyond that. There is no manual "clear the cache" operation
 * to build or call -- Anthropic's cache is a pure function of the exact
 * cached bytes and expires on its own (5 minutes idle by default,
 * refreshed on every hit); the only way to force a miss is to change the
 * content, which happens naturally whenever a skill file is edited.
 * `llmPricing.ts`'s `estimateCostUsd` and `graphLogMetrics.server.ts`'s
 * rollup both account for cache read/write tokens separately from plain
 * input tokens so /fruits/maker's cost estimate stays accurate.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ImagesDescriptionInput,
  LlmEffort,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmUsage,
  PhotoDescriber,
  PhotoDescriptionInput,
  PhotoDescriptionResult,
  StopReason,
  ToolCall,
  ToolDefinition,
} from "./llmProvider";

const DEFAULT_MODEL = "claude-sonnet-5";
// `max_tokens` is NOT a content budget on this model family. Thinking is
// on by default and its tokens count against the same limit, and the
// model decides how much to think per call. At 8192 a busy day's first
// turn spent the whole limit deliberating and returned NOTHING -- no
// text, no tool call -- and the day was recorded as "captured nothing".
// Every agent loop already bounds its own CONTENT per turn in code (one
// write call per turn, `planTurnToolCalls`), so this number only has to
// leave room for the model's deliberation. It is generous on purpose:
// tokens are billed as used, not as budgeted, and a cut here costs a
// whole turn's thinking with nothing to show for it. Streamed (below)
// so a large limit never trips the SDK's non-streaming timeout.
const DEFAULT_MAX_TOKENS = 32768;
// The effort the API applies when none is sent. Named here so the
// per-stage choice (`LlmEffort`) has a visible baseline; overridable
// per provider (`PHYLOG_ANTHROPIC_EFFORT`) and per call (`effort`).
const DEFAULT_EFFORT: LlmEffort | undefined = undefined;

/** The GraphLog stages that call a model. */
export type GraphLogModelStage = "sync-knowledge" | "sync-graph" | "graph-structure" | "graph-project-view";

/**
 * Which model, at what effort, each stage runs on when nothing overrides
 * it. Chosen from a measured grid (2026-09-11, Crouch Casita, three days
 * and a full reset build per configuration; see the vault's coding loops
 * for the tables), not from a general sense of which model is "better":
 *
 * - `sync-graph` selects lines from logs. Every model captured the same
 *   content; effort changed cost and time, not what was kept. Sonnet at
 *   medium matched Sonnet at high for three quarters of the cost.
 * - `graph-structure` disagreed with itself about thread count (3 to 15
 *   on one graph) more than the models disagreed with each other, so it
 *   stays on the previous default until the skill pins granularity.
 * - `graph-project-view` is where judgment shows. Only Opus read time
 *   across the graph ("targeted next week" written 16 days ago and still
 *   open; an estimate made under 115-degree days never re-estimated).
 *   Opus at medium kept that for about 70% of Opus at high. Then on
 *   2026-09-14, with PROJECT_VIEW.md rewritten as goals and boundaries
 *   rather than steps, a held-structure control (one Sonnet-built index,
 *   two READMEs per cell) put Fable 5.1 at high ahead: no uncited
 *   thread and no invented fact in three readings, openers that name
 *   what nobody has logged movement on and for how long, at a fixed
 *   $0.10 to $0.15 more per README (output tokens cost double, it
 *   writes fewer; the part that grows with the graph is cached input,
 *   cheaper on Fable). Austin's call: the output skills are heading
 *   toward Fable's strengths, not away. Re-measure when the next output
 *   skill exists. Fable refuses through `stop_reason: "refusal"`, which
 *   `mapStopReason` reports as "other"; a refused pass shows as a
 *   stopped run, not a silent empty README.
 * - `sync-knowledge` describes photos and extracts sidecars; untested in
 *   the grid, left on the previous default.
 *
 * Override per stage with `PHYLOG_ANTHROPIC_MODEL_<STAGE>` /
 * `PHYLOG_ANTHROPIC_EFFORT_<STAGE>` (stage upper-cased, dashes to
 * underscores), or every stage at once with `PHYLOG_ANTHROPIC_MODEL` /
 * `PHYLOG_ANTHROPIC_EFFORT`. A test that hands a stage its own
 * `provider` bypasses all of this.
 */
const STAGE_DEFAULTS: Record<GraphLogModelStage, { model: string; effort?: LlmEffort }> = {
  "sync-knowledge": { model: DEFAULT_MODEL },
  "sync-graph": { model: DEFAULT_MODEL, effort: "medium" },
  "graph-structure": { model: DEFAULT_MODEL, effort: "high" },
  "graph-project-view": { model: "claude-fable-5-1", effort: "high" },
};

/** The model and effort `stage` runs on, after env overrides. Exported
 * so the run page or a CLI can say what a stage WOULD use. */
export function modelForStage(stage: GraphLogModelStage): { model: string; effort?: LlmEffort } {
  const key = stage.toUpperCase().replace(/-/g, "_");
  const d = STAGE_DEFAULTS[stage];
  const model = process.env[`PHYLOG_ANTHROPIC_MODEL_${key}`] ?? process.env.PHYLOG_ANTHROPIC_MODEL ?? d.model;
  const effort =
    (process.env[`PHYLOG_ANTHROPIC_EFFORT_${key}`] as LlmEffort | undefined) ??
    (process.env.PHYLOG_ANTHROPIC_EFFORT as LlmEffort | undefined) ??
    d.effort;
  return effort ? { model, effort } : { model };
}
/** Vision calls want a paragraph, not a whole README — kept separate from
 * `DEFAULT_MAX_TOKENS` so tightening one doesn't silently affect the
 * other. */
const PHOTO_DESCRIPTION_MAX_TOKENS = 512;

const PHOTO_DESCRIPTION_SYSTEM_PROMPT = `You are describing a photo that was attached to a project's daily-log Card. Write a short, factual paragraph (2-4 sentences) capturing what the photo actually shows — objects, people, setting, visible state of progress — grounded ONLY in what's visible plus the text context you're given. Never speculate beyond what's visible. No preamble, no "this photo shows" framing — just the description itself.`;

const ANTHROPIC_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}

/** Anthropic's `messages` array uses CONTENT BLOCKS (text/tool_use/
 * tool_result mixed within one message), not our one-role-per-kind
 * `LlmMessage` union — this folds consecutive `tool_result` entries into
 * a single Anthropic `user` message (required: every `tool_use` needs its
 * `tool_result` in the very next message, all in one go). */
function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content });
    } else {
      const last = out[out.length - 1];
      const block: Anthropic.ContentBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

const CACHE_CONTROL_EPHEMERAL: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

// --- Prompt caching -------------------------------------------------------
// See this file's own module doc for the negatives/tradeoffs; in short:
// a cache_control breakpoint marks "everything up to and including this
// block is worth caching for reuse." Below the ~1024-token minimum for
// Sonnet-family models, Anthropic silently ignores the marker (no error,
// no cost) -- so it's always safe to add, the only real cost is a ~25%
// premium on writing a prefix that never gets read back again.

/** The system prompt is identical across EVERY turn of one day's capture
 * loop, and across EVERY file pre-capture summarizes within one project
 * run (both build `skillContent` once, outside their own per-item loop)
 * -- caching it (which, since tools/system precede messages in the
 * request, also covers the (static) tool definitions for free) benefits
 * both call sites without any call-site changes, PROVIDED the caller
 * actually expects reuse (`cacheSystemPrompt`) or this call is already
 * mid-multi-turn (`multiTurn`, computed in `complete` below) -- see
 * `complete`'s own comment for why neither is assumed by default. */
function toAnthropicSystem(system: string): string | Anthropic.TextBlockParam[] {
  if (!system) return system;
  return [{ type: "text", text: system, cache_control: CACHE_CONTROL_EPHEMERAL }];
}

/** Marks the LAST content block of the LAST message with a cache
 * breakpoint. Only called from turn 2+ of a growing conversation (see
 * `complete`'s `multiTurn`) -- a turn-1 call doesn't yet know whether
 * there'll ever be a turn 2 to read it back, so marking it there would
 * be a pure premium for the (likely common, given capture's own bias
 * toward "do nothing on a quiet day") single-turn case. From turn 2 on,
 * we're already committed to a multi-turn exchange, so the bet that a
 * turn 3 might also happen is a much better one. */
function withLastMessageCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const lastIndex = out.length - 1;
  const last = out[lastIndex];
  const content: Anthropic.ContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  if (content.length === 0) return out;
  const lastBlockIndex = content.length - 1;
  // Every block WE ever construct (text/tool_use/tool_result -- see
  // `toAnthropicMessages` above) supports cache_control; the cast is only
  // needed because `ContentBlockParam`'s union also includes block kinds
  // (e.g. extended-thinking blocks) that this app never produces, which
  // don't carry the field and make a bare spread ambiguous to the
  // checker.
  content[lastBlockIndex] = {
    ...content[lastBlockIndex],
    cache_control: CACHE_CONTROL_EPHEMERAL,
  } as Anthropic.ContentBlockParam;
  out[lastIndex] = { ...last, content };
  return out;
}

function toLlmUsage(usage: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  };
}

/** The thinking configuration for a tool-calling call on `model`.
 * Adaptive thinking with a readable summary on the current family: the
 * summary costs nothing extra (display is visibility only, thinking is
 * billed the same either way) and is what lets a run page say WHAT the
 * model deliberated on a turn that produced no content. Haiku 4.5 still
 * takes the old budget form and rejects `adaptive`, so it gets no
 * thinking parameter at all (which on Haiku means no thinking). */
function thinkingFor(model: string): Anthropic.MessageCreateParams["thinking"] | undefined {
  if (model.startsWith("claude-haiku")) return undefined;
  return { type: "adaptive", display: "summarized" } as Anthropic.MessageCreateParams["thinking"];
}

/** Whether `thinking: {type: "disabled"}` is accepted on `model`. Used
 * only by the vision call, whose 512-token limit has no room for
 * deliberation and whose output is a paragraph, not a tool call (the
 * documented failure mode of disabling thinking is a tool call written
 * into visible text, which cannot happen with no tools). */
function canDisableThinking(model: string): boolean {
  return !model.startsWith("claude-haiku") && !model.startsWith("claude-fable") && !model.startsWith("claude-mythos");
}

export class AnthropicProvider implements LlmProvider, PhotoDescriber {
  private client: Anthropic;
  private model: string;
  private effort: LlmEffort | undefined;

  /** The provider a stage runs on when the caller hands it none -- see
   * `STAGE_DEFAULTS`. Every stage's own `opts.provider ?? ...` default
   * goes through here, so the per-stage choice lives in one table. */
  static forStage(stage: GraphLogModelStage): AnthropicProvider {
    return new AnthropicProvider(modelForStage(stage));
  }

  constructor(options: { apiKey?: string; model?: string; workspaceId?: string; effort?: LlmEffort } = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — required to use GraphLog's Anthropic provider.",
      );
    }
    // Required by any API key that isn't pinned to exactly one workspace
    // at creation (a "Personal"/service-account key scoped to "all
    // workspaces you have access to", which is what the Console hands you
    // by default -- even picking the org's own Default Workspace there
    // isn't enough to avoid this, see the `graphlog` skill's own "API key
    // is invalid"/"anthropic-workspace-id is required" writeup). Optional
    // on purpose: a key genuinely scoped to one workspace at creation
    // (legacy Workspace keys, or a Personal/service-account key pinned to
    // a non-default workspace) works fine with this header omitted, and
    // Anthropic ignores it being absent rather than erroring -- so this
    // is safe to leave unset for that key type.
    const workspaceId = options.workspaceId ?? process.env.ANTHROPIC_WORKSPACE_ID;
    this.client = new Anthropic({
      apiKey,
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
    this.model = options.model ?? process.env.PHYLOG_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.effort = options.effort ?? (process.env.PHYLOG_ANTHROPIC_EFFORT as LlmEffort | undefined) ?? DEFAULT_EFFORT;
  }

  async complete(input: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
    cacheSystemPrompt?: boolean;
    maxTokens?: number;
    effort?: LlmEffort;
  }): Promise<LlmResponse> {
    // `messages.length > 1` means this ISN'T the first turn of a
    // multi-turn exchange -- there's already at least one prior
    // assistant/tool_result round trip in the growing history, so the
    // system prompt (and everything before this point) is GUARANTEED to
    // be resent on this call, unlike a cold first call where we don't
    // yet know if there'll ever be a second one. This is a strictly
    // better signal than "has tools" alone (a single-turn, no-tool-call
    // day -- the common quiet-day case -- used to pay a write premium on
    // the whole first prompt for zero benefit; now it doesn't).
    const multiTurn = input.messages.length > 1;
    const cacheSystem = (input.cacheSystemPrompt ?? false) || multiTurn;
    const messages = toAnthropicMessages(input.messages);
    const effort = input.effort ?? this.effort;
    const thinking = thinkingFor(this.model);
    // Streamed, for two reasons. The SDK's non-streaming path has a
    // timeout that a large `max_tokens` can trip. And the final message
    // OMITS a `tool_use` block that was cut off by `max_tokens`, so the
    // stream is the only place its JSON prefix can be read -- which is
    // the difference between "cut off writing a node for Source 3" and
    // "produced nothing". `finalMessage()` still assembles the complete
    // blocks the same way `create()` would return them.
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: cacheSystem ? toAnthropicSystem(input.system) : input.system,
      messages: multiTurn ? withLastMessageCacheBreakpoint(messages) : messages,
      tools: toAnthropicTools(input.tools),
      ...(thinking ? { thinking } : {}),
      ...(effort ? { output_config: { effort } } : {}),
    });
    // Only the LAST tool_use block can be the unfinished one; track the
    // one currently open and its accumulated JSON.
    let openTool: { name: string; inputJson: string; closed: boolean } | null = null;
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        openTool = { name: event.content_block.name, inputJson: "", closed: false };
      } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta" && openTool) {
        openTool.inputJson += event.delta.partial_json;
      } else if (event.type === "content_block_stop" && openTool) {
        openTool.closed = true;
      }
    }
    const response = await stream.finalMessage();

    let text: string | null = null;
    const toolCalls: ToolCall[] = [];
    let thinkingBlocks = 0;
    let thinkingText: string | null = null;
    for (const block of response.content) {
      if (block.type === "text") {
        text = (text ?? "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      } else if (block.type === "thinking") {
        thinkingBlocks++;
        if (block.thinking) thinkingText = (thinkingText ?? "") + block.thinking;
      }
    }
    const stopReason = mapStopReason(response.stop_reason);
    // A tool block that was still open when the stream ended, on a cut,
    // is the one the API dropped. On any other stop every block closed.
    const partialToolCall =
      stopReason === "max_tokens" && openTool && !openTool.closed
        ? { name: openTool.name, inputJson: openTool.inputJson }
        : null;

    return {
      text,
      toolCalls,
      thinking: { blocks: thinkingBlocks, text: thinkingText },
      partialToolCall,
      stopReason,
      usage: toLlmUsage(response.usage),
      model: this.model,
    };
  }

  /** See `PhotoDescriber` (`llmProvider.ts`) for the design reasoning —
   * a plain, single-turn vision call, no tools, no message history. */
  async describePhoto(input: PhotoDescriptionInput): Promise<PhotoDescriptionResult> {
    return this.describeImages({
      images: [{ imageBase64: input.imageBase64, mediaType: input.mediaType, label: "" }],
      context: input.context,
      framing: PHOTO_DESCRIPTION_SYSTEM_PROMPT,
    });
  }

  /** Several images, one description. Each image is preceded by its label
   * as a text block, so the model can refer to "the frame at 0:17". */
  async describeImages(input: ImagesDescriptionInput): Promise<PhotoDescriptionResult> {
    if (input.images.length === 0) throw new Error("describeImages needs at least one image");
    for (const image of input.images) {
      if (!ANTHROPIC_IMAGE_MEDIA_TYPES.has(image.mediaType)) {
        throw new Error(`Unsupported image media type for description: ${image.mediaType}`);
      }
    }
    const content: Anthropic.ContentBlockParam[] = [];
    for (const image of input.images) {
      if (image.label) content.push({ type: "text", text: image.label });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType as Anthropic.Base64ImageSource["media_type"],
          data: image.imageBase64,
        },
      });
    }
    content.push({ type: "text", text: input.context || "(no additional context provided)" });

    // 512 tokens is a paragraph, and on this model family thinking is on
    // by default and counts against it -- the same latent cut as the
    // tool-calling path, which happened not to bite here only because the
    // model rarely deliberates over a photo. Made explicit rather than
    // left to chance; a model that rejects the disabled form gets no
    // parameter (Haiku: no thinking; Fable: always thinks, so the limit
    // is raised instead -- see `PHOTO_DESCRIPTION_MAX_TOKENS`'s use).
    const disable = canDisableThinking(this.model);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: disable || this.model.startsWith("claude-haiku") ? PHOTO_DESCRIPTION_MAX_TOKENS : PHOTO_DESCRIPTION_MAX_TOKENS * 8,
      system: input.framing,
      messages: [{ role: "user", content }],
      ...(disable ? { thinking: { type: "disabled" } as Anthropic.MessageCreateParams["thinking"] } : {}),
    });

    const description = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return { description, usage: toLlmUsage(response.usage), model: this.model };
  }
}

/** The single-photo framing, exported so `sync-knowledge` can build the
 * video framing from it rather than restating it. */
export { PHOTO_DESCRIPTION_SYSTEM_PROMPT };

/** Whether a real Anthropic call can be made right now — checked by both
 * API routes and the CLI, same "absent env var = feature off" convention
 * `SORTER_ENABLED` already uses, so a fresh deploy never spends money on
 * an LLM call until this is explicitly configured. */
export function isGraphLogAgentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
