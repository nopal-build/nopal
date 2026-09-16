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
 * `cacheReadTokens`/`cacheWriteTokens` were added here before anything
 * used prompt caching, so turning it on later wouldn't need an interface
 * change. All three GraphLog agent loops now both request caching and
 * accumulate these -- they're optional because a provider may not report
 * them, NOT because they're unused. Anything that sums an `LlmUsage`
 * needs to sum these two as well, or the cost estimate silently prices
 * cached tokens at full rate. */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/**
 * Decides which of one response's tool calls may actually be executed this
 * turn: every read, but AT MOST ONE WRITE.
 *
 * A provider may return several `tool_use` blocks in a single response, and
 * all of them are generated into that ONE response's output budget. A write
 * call's input carries real content (a node's text, a cluster's whole node
 * list, a README section's prose), so N writes in a turn is N pieces of
 * content against one `max_tokens`. That is not theoretical: it truncated a
 * real `sync-graph` day, and later a real `graph-structure` batch at six
 * `update_cluster` calls in one turn.
 *
 * Reads are unrestricted on purpose. A `get_node` call's input is one id;
 * batching several costs nothing in output, and throttling them would just
 * spend turns.
 *
 * A rejected call is NOT dropped: the caller feeds `rejectionMessage` back
 * as its tool result, and the model re-issues it on a later turn. The
 * alternative (executing it anyway) is what the loops used to do.
 *
 * Shared by all three agent loops rather than hand-rolled in each, because
 * this is one invariant and three copies of it drift. See ADR-013
 * (docs/adr/0013-turn-limit-never-the-content-limit.md, kept out of the public repo) for why the
 * per-turn bound is a bound on ONE PASS, never on how much content a day or
 * a run may hold.
 */
export function planTurnToolCalls<T extends { name: string }>(
  calls: T[],
  isWrite: (name: string) => boolean,
): { call: T; execute: boolean }[] {
  let wrote = false;
  return calls.map((call) => {
    if (!isWrite(call.name)) return { call, execute: true };
    if (wrote) return { call, execute: false };
    wrote = true;
    return { call, execute: true };
  });
}

/**
 * The tool calls from a response that are safe to execute, given how it
 * stopped.
 *
 * A `max_tokens` response is not empty, it is CUT OFF. The provider still
 * returns every content block generated before the limit, and only the
 * LAST one can be half-finished — a `tool_use` whose JSON input stopped
 * mid-string, which arrives here as a plausible-looking object with a
 * field missing rather than as a parse error. Executing that writes
 * half a section. Discarding the whole response instead (what the loops
 * used to do) throws away the complete calls in front of it, which on a
 * freshly-reset README is the difference between partial content and no
 * content at all.
 *
 * So: drop the last call, keep the rest. A complete final call that
 * happened to land exactly on the limit is lost too, which is the
 * conservative direction — it is retried on the next run, and the
 * alternative is guessing whether a truncated object is complete.
 *
 * Every other stop reason returns the calls untouched.
 */
export function completedToolCalls<T>(calls: T[], stopReason: StopReason): T[] {
  return stopReason === "max_tokens" ? calls.slice(0, -1) : calls;
}

/**
 * Which section the call `completedToolCalls` dropped was writing, when
 * that can be known.
 *
 * The dropped call's input is a partial object, and `heading` is the
 * first key in every section-writing schema, so it is usually intact
 * even when `content` is the field that was cut. That name is the
 * difference between "a pass was cut off" and "writing 'What's carrying
 * weight' was cut off", which is what the next pass needs in order to
 * write that one section shorter, and what a person needs when it keeps
 * happening. Read it BEFORE `completedToolCalls` slices the call away;
 * nothing downstream ever sees it again.
 *
 * `null` on any other stop reason, when there was no call at all, or when
 * the cut landed inside the heading itself and the input has no string
 * heading to read. The caller degrades to "a section" then, never guesses.
 */
export function cutOffHeading<T extends { input: Record<string, unknown> }>(
  calls: T[],
  stopReason: StopReason,
): string | null {
  if (stopReason !== "max_tokens") return null;
  const last = calls[calls.length - 1];
  if (!last) return null;
  const heading = last.input?.heading;
  return typeof heading === "string" ? heading : null;
}

/**
 * Which source the `add_node` call `completedToolCalls` dropped was
 * writing a node for, when that can be known. `sync-graph`'s twin of
 * `cutOffHeading`: `sourceIndex` is the first key in `add_node`'s schema,
 * so it is usually intact even when `blocks` is the field that was cut.
 * A separate helper rather than a keyed `cutOffHeading` because the two
 * schemas name different first fields and the read is three lines.
 *
 * `null` on any other stop reason, when there was no call at all, or
 * when the cut landed before the index was written. The caller says
 * "before it started any node" then, never guesses.
 */
export function cutOffSourceIndex<T extends { input: Record<string, unknown> }>(
  calls: T[],
  stopReason: StopReason,
  /** The cut-off call's raw JSON prefix, when the provider streamed it
   * (`LlmResponse.partialToolCall`). The API drops an unfinished
   * `tool_use` block from the final message entirely, so on a real cut
   * this is usually the ONLY place the index survives. */
  partialToolJson?: string | null,
): number | null {
  if (stopReason !== "max_tokens") return null;
  const last = calls[calls.length - 1];
  const index = last?.input?.sourceIndex;
  if (typeof index === "number" && Number.isInteger(index)) return index;
  const fromPrefix = partialToolJson ? /"sourceIndex"\s*:\s*(\d+)/.exec(partialToolJson)?.[1] : undefined;
  return fromPrefix !== undefined ? Number(fromPrefix) : null;
}

/**
 * A heading the model wrote, as a heading: leading markdown hashes and
 * the whitespace after them removed. Two models in the same test handed
 * `update_cluster` the value "## Siding install", and code that only
 * trimmed whitespace wrote `## ## Siding install` into graph-structure.md.
 * The tool asks for the heading TEXT; this makes the code read it that
 * way whatever the model does.
 */
export function headingText(raw: string): string {
  return raw.trim().replace(/^#+\s*/, "").trim();
}

/** How hard the model is asked to think on one call. Maps to the API's
 * `output_config.effort`; the API default is `high`. Passed per call so a
 * stage that selects lines (extraction) and a stage that judges (the
 * README) can spend differently -- see `AnthropicProvider`. */
export type LlmEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type LlmResponse = {
  /** Any plain text the model produced alongside (or instead of) a tool
   * call — e.g. its reasoning for NOT calling a tool this turn. */
  text: string | null;
  toolCalls: ToolCall[];
  /** What the model spent on deliberation before (or instead of) any
   * content this call. On the current model family thinking is ON BY
   * DEFAULT and its tokens count against `max_tokens`, and nothing here
   * surfaced it: a turn that hit the limit with `text` null and
   * `toolCalls` empty read as "the model produced nothing", when it had
   * produced 8192 tokens of thinking and been cut off before the first
   * tool call. That is exactly how a real day was lost. `blocks` is how
   * many thinking blocks arrived; `text` is the API's summary of them
   * (requested by the provider), null when the model did not think or
   * no summary was returned. */
  thinking: { blocks: number; text: string | null };
  /** The `tool_use` block that was still being generated when the model
   * hit `max_tokens`, as the raw JSON prefix streamed so far. The final
   * message omits an unfinished block entirely, so without streaming a
   * cut mid-call is indistinguishable from a call that never started.
   * Null on every other stop, and when the cut fell outside a tool call. */
  partialToolCall: { name: string; inputJson: string } | null;
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
    /** Overrides the provider's own default output budget -- for a call
     * whose output size scales with something other than "one project's
     * one section/day" (e.g. `graph-structure`, whose output scales with
     * a WHOLE graph's total node count and keeps growing for as long as
     * the project exists). Omit for the provider's own normal default. */
    maxTokens?: number;
    /** See `LlmEffort`. Omit for the provider's own default. */
    effort?: LlmEffort;
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

/** One of several images described together -- the frames of a video,
 * in order. `label` is what the model is told about each ("0:17 into the
 * clip"), so the description can say what changes between them. */
export type LabeledImage = { imageBase64: string; mediaType: string; label: string };

export type ImagesDescriptionInput = {
  images: LabeledImage[];
  /** Same role as `PhotoDescriptionInput.context`. */
  context: string;
  /** Replaces the single-photo system prompt: what these images are as a
   * set and how to describe them. Assembled by the caller. */
  framing: string;
};

export interface PhotoDescriber {
  describePhoto(input: PhotoDescriptionInput): Promise<PhotoDescriptionResult>;
  /** Several images in one call, one description. A video is the case
   * this exists for: a few stills, described as a sequence, so the whole
   * pipeline downstream sees a video exactly as it sees a photo. */
  describeImages(input: ImagesDescriptionInput): Promise<PhotoDescriptionResult>;
}
