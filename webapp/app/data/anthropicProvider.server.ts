/**
 * `LlmProvider` (`llmProvider.ts`) implemented against Anthropic's Messages
 * API — PhyLog's first LLM backend, per the `vault` skill's PhyLog Agent
 * section. Translates the generic message/tool shape both directions;
 * `phylogAgent.server.ts` never touches the Anthropic SDK directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmMessage,
  LlmProvider,
  LlmResponse,
  StopReason,
  ToolCall,
  ToolDefinition,
} from "./llmProvider";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;

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

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — required to use PhyLog's Anthropic provider.",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? process.env.PHYLOG_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async complete(input: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: input.system,
      messages: toAnthropicMessages(input.messages),
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

    return { text, toolCalls, stopReason: mapStopReason(response.stop_reason) };
  }
}

/** Whether a real Anthropic call can be made right now — checked by both
 * API routes and the CLI, same "absent env var = feature off" convention
 * `SORTER_ENABLED` already uses, so a fresh deploy never spends money on
 * an LLM call until this is explicitly configured. */
export function isPhylogAgentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
