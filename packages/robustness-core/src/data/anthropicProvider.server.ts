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
// A tool-calling turn that re-emits a substantial chunk of content (a
// README section, a cluster) in one call can truncate mid-generation
// (stop_reason "max_tokens") at a smaller budget -- every caller's own
// agent loop detects this and refuses to apply a truncated result, but a
// generous default avoids hitting it at all for most calls. A caller
// whose own output genuinely scales differently (e.g. `graph-structure`'s
// original whole-graph-rebuild shape, since redesigned -- see the
// `graphlog` skill) can still override via `maxTokens`.
const DEFAULT_MAX_TOKENS = 8192;
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

export class AnthropicProvider implements LlmProvider, PhotoDescriber {
  private client: Anthropic;
  private model: string;

  constructor(options: { apiKey?: string; model?: string; workspaceId?: string } = {}) {
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
  }

  async complete(input: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
    cacheSystemPrompt?: boolean;
    maxTokens?: number;
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
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: cacheSystem ? toAnthropicSystem(input.system) : input.system,
      messages: multiTurn ? withLastMessageCacheBreakpoint(messages) : messages,
      tools: toAnthropicTools(input.tools),
    });

    let text: string | null = null;
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        text = (text ?? "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      stopReason: mapStopReason(response.stop_reason),
      usage: toLlmUsage(response.usage),
      model: this.model,
    };
  }

  /** See `PhotoDescriber` (`llmProvider.ts`) for the design reasoning —
   * a plain, single-turn vision call, no tools, no message history. */
  async describePhoto(input: PhotoDescriptionInput): Promise<PhotoDescriptionResult> {
    if (!ANTHROPIC_IMAGE_MEDIA_TYPES.has(input.mediaType)) {
      throw new Error(`Unsupported image media type for description: ${input.mediaType}`);
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: PHOTO_DESCRIPTION_MAX_TOKENS,
      system: PHOTO_DESCRIPTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType as Anthropic.Base64ImageSource["media_type"],
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: input.context || "(no additional context provided)",
            },
          ],
        },
      ],
    });

    const description = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return { description, usage: toLlmUsage(response.usage), model: this.model };
  }
}

/** Whether a real Anthropic call can be made right now — checked by both
 * API routes and the CLI, same "absent env var = feature off" convention
 * `SORTER_ENABLED` already uses, so a fresh deploy never spends money on
 * an LLM call until this is explicitly configured. */
export function isGraphLogAgentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
