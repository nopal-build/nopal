/**
 * A small, provider-agnostic tool-calling interface — the seam between
 * PhyLog's agent logic (`phylogAgent.server.ts`) and whichever LLM actually
 * powers it. Deliberately minimal: just enough to run a single-turn (today)
 * or multi-turn (once more tools exist) tool-calling exchange, not a
 * general chat SDK wrapper.
 *
 * `AnthropicProvider` (`anthropicProvider.server.ts`) is the first, and
 * today only, implementation — per PhyLog's own design decision, this
 * interface exists specifically so a second provider is a new file
 * implementing `LlmProvider`, never a change to `phylogAgent.server.ts`
 * itself.
 *
 * This file has NO server-only imports (no API keys, no SDK) so it's safe
 * to import from anywhere — only the concrete provider implementations are
 * `.server.ts`.
 */

export type ToolDefinition = {
  name: string;
  description: string;
  /** A JSON Schema object describing the tool's input — passed through
   * verbatim to whichever provider's own tool-use format expects it. */
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool_result"; toolCallId: string; content: string };

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

/** Token counts only — no dollar estimate here on purpose. Usage tracking
 * (`phylogMetrics.server.ts`) is deliberately tokens-only for now; a $
 * conversion can be layered on top later without touching this interface.
 * `cacheReadTokens`/`cacheWriteTokens` are here even though nothing uses
 * prompt caching yet, so turning it on later doesn't need an interface
 * change. */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type LlmResponse = {
  /** Any plain text the model produced alongside (or instead of) a tool
   * call — e.g. its reasoning for NOT calling a tool this turn. */
  text: string | null;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: LlmUsage;
  /** Which model actually served this call — for usage tracking
   * (`phylogMetrics.server.ts`), so a future model change shows up in the
   * data instead of being assumed. */
  model: string;
};

export interface LlmProvider {
  complete(input: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
    /** Hint from the CALLER -- who knows things a single `complete()` call
     * can't, like "there are 6 more files in this same project run that
     * will send this exact same system prompt" -- that this system
     * prompt is worth caching for reuse by a LATER, separate call. Purely
     * advisory: a provider with no caching support is free to ignore it,
     * and a provider that DOES support caching should still use its own
     * judgment for the growing conversation WITHIN this one call (see
     * `AnthropicProvider`, which caches multi-turn history automatically
     * once `messages.length > 1`, independent of this flag). Omit/false
     * when a call is genuinely one-off, since caching a prefix that's
     * never read again is pure added cost, not savings. */
    cacheSystemPrompt?: boolean;
  }): Promise<LlmResponse>;
}

/**
 * A second, deliberately SEPARATE small interface — vision, not tool-
 * calling. PhyLog's pre-capture stage (`preCapture.server.ts`) uses this
 * to turn one photo's bytes plus its own text context (a Card's
 * caption for it, the project it belongs to) into a plain-text description,
 * BEFORE the README-writing step ever runs — so `runAgentLoop`'s own
 * `LlmProvider` never needs image content blocks at all. Kept separate
 * from `LlmProvider` (rather than folding an optional image param into
 * `complete`) because the two calls have nothing else in common: no tools,
 * no multi-turn loop, no system prompt swapping — just "describe this
 * photo, given this context".
 *
 * `AnthropicProvider` (`anthropicProvider.server.ts`) implements BOTH
 * interfaces off the same underlying client — a second provider is free
 * to do the same, or implement only one of the two if it can't (or
 * shouldn't) do vision.
 */
export type PhotoDescriptionInput = {
  /** Raw image bytes, base64-encoded. */
  imageBase64: string;
  /** e.g. "image/jpeg" — passed straight through to the provider's own
   * image content block. */
  mediaType: string;
  /** Whatever text context should ground the description — the Card's
   * own caption for this photo, the project/day it was logged against,
   * etc. Assembled by the caller, not this interface. */
  context: string;
};

export type PhotoDescriptionResult = {
  description: string;
  usage: LlmUsage;
  model: string;
};

export interface PhotoDescriber {
  describePhoto(input: PhotoDescriptionInput): Promise<PhotoDescriptionResult>;
}
