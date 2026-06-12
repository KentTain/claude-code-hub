/**
 * Request Transformer: Response API -> Chat Completions
 *
 * 将 OpenAI Response API 格式的请求体转换为 Chat Completions 格式，
 * 以便转发到只支持 Chat Completions 的上游供应商（如百度千帆）。
 */

import type {
  ResponseRequest,
  InputItem,
  MessageInput,
  ToolOutputsInput,
  ContentItem,
  TextContent,
  ImageContent,
} from "@/app/v1/_lib/codex/types/response";
import type {
  ChatCompletionRequest,
  ChatMessage,
  ContentPart,
  ChatCompletionTool,
} from "@/app/v1/_lib/codex/types/compatible";
import type { UpstreamFormat } from "./types";

/**
 * 将 Response API 请求转换为 Chat Completions 请求
 *
 * 转换规则：
 * - input[] -> messages[]
 * - instructions -> system message
 * - tool_outputs -> role: "tool" messages
 * - ContentItem[] -> ContentPart[]
 * - max_output_tokens -> max_tokens
 * - tools, tool_choice, reasoning 等参数直接透传
 */
export function transformRequestToChatCompletions(
  request: ResponseRequest
): ChatCompletionRequest {
  const messages: ChatMessage[] = [];

  // 1. instructions -> system message
  if (request.instructions) {
    messages.push({
      role: "system",
      content: request.instructions,
    });
  }

  // 2. input[] -> messages[]
  for (const item of request.input) {
    const msg = transformInputItem(item);
    if (msg) {
      if (Array.isArray(msg)) {
        messages.push(...msg);
      } else {
        messages.push(msg);
      }
    }
  }

  // 3. 构建请求体
  const result: ChatCompletionRequest = {
    model: request.model,
    messages,
    stream: request.stream,
  };

  // 4. 通用参数透传
  if (request.temperature !== undefined) {
    result.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    result.top_p = request.top_p;
  }
  if (request.max_output_tokens !== undefined) {
    result.max_tokens = request.max_output_tokens;
  }
  if (request.tools) {
    result.tools = transformTools(request.tools);
  }
  if (request.tool_choice) {
    result.tool_choice = request.tool_choice;
  }
  if (request.parallel_tool_calls !== undefined) {
    result.parallel_tool_calls = request.parallel_tool_calls;
  }
  if (request.reasoning) {
    result.reasoning = request.reasoning;
  }
  if (request.user) {
    result.user = request.user;
  }
  if (request.metadata) {
    result.metadata = request.metadata;
  }

  return result;
}

/**
 * 转换单个 InputItem 为 ChatMessage 或 ChatMessage 数组
 */
function transformInputItem(item: InputItem): ChatMessage | ChatMessage[] | null {
  if ("type" in item && item.type === "tool_outputs") {
    return transformToolOutputs(item as ToolOutputsInput);
  }
  return transformMessageInput(item as MessageInput);
}

/**
 * MessageInput -> ChatMessage
 *
 * Response API: { role: "user"|"assistant"|"developer", content: ContentItem[] }
 * Chat Completions: { role: "system"|"user"|"assistant", content: string|ContentPart[] }
 */
function transformMessageInput(item: MessageInput): ChatMessage {
  const role = item.role === "developer" ? "system" : item.role;
  const content = transformContentItems(item.content);
  return { role, content };
}

/**
 * ToolOutputsInput -> ChatMessage[]
 *
 * Response API: { type: "tool_outputs", outputs: [{ call_id, output }] }
 * Chat Completions: { role: "tool", tool_call_id: call_id, content: output }
 */
function transformToolOutputs(item: ToolOutputsInput): ChatMessage[] {
  return item.outputs.map((output) => ({
    role: "tool" as ChatMessage["role"],
    tool_call_id: output.call_id,
    content: output.output,
  }));
}

/**
 * ContentItem[] -> string | ContentPart[]
 *
 * Response API:
 * - { type: "input_text", text: "..." }
 * - { type: "output_text", text: "..." }
 * - { type: "input_image", image_url: "..." }
 *
 * Chat Completions:
 * - string (纯文本)
 * - { type: "text", text: "..." }
 * - { type: "image_url", image_url: { url: "..." } }
 */
function transformContentItems(items: ContentItem[]): string | ContentPart[] {
  if (items.length === 0) {
    return "";
  }

  // 纯文本优化：单个文本项直接返回字符串
  if (items.length === 1 && (items[0].type === "input_text" || items[0].type === "output_text")) {
    return (items[0] as TextContent).text;
  }

  const parts: ContentPart[] = [];
  for (const item of items) {
    if (item.type === "input_text" || item.type === "output_text") {
      parts.push({ type: "text", text: (item as TextContent).text });
    } else if (item.type === "input_image") {
      parts.push({
        type: "image_url",
        image_url: { url: (item as ImageContent).image_url },
      });
    }
  }

  return parts;
}

/**
 * Response API tools -> Chat Completions tools
 *
 * 两者结构一致（type: "function", function: { name, description, parameters, strict }），
 * 可直接类型转换。
 */
function transformTools(tools: ResponseRequest["tools"]): ChatCompletionTool[] | undefined {
  if (!tools) return undefined;
  return tools as unknown as ChatCompletionTool[];
}

/**
 * 判断是否需要请求格式转换
 */
export function needsRequestTransform(upstreamFormat: UpstreamFormat): boolean {
  return upstreamFormat === "chatcompletions";
}