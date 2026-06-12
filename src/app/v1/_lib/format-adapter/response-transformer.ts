/**
 * Chat Completions -> Response API 响应转换器
 */

import type {
  ChatCompletionResponse,
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChunkChoice,
} from "../codex/types/compatible";
import type {
  ResponseObject,
  OutputItem,
  MessageOutput,
  ToolCallsOutput,
  ToolCall,
  OutputContent,
} from "../codex/types/response";

import { generateId } from "./types";

/** 将 Chat Completions 非流式响应转换为 Response API 格式 */
export function transformResponse(
  ccResponse: ChatCompletionResponse
): ResponseObject {
  const output: OutputItem[] = [];
  const choice = ccResponse.choices?.[0];
  if (choice) {
    const { message } = choice;
    // Handle tool_calls in message
    if ((message as unknown as Record<string, unknown>).tool_calls) {
      const toolCalls = (message as unknown as Record<string, unknown>).tool_calls as Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
      output.push({
        id: generateId("tc"),
        type: "tool_calls",
        tool_calls: toolCalls.map(
          (tc): ToolCall => ({
            id: tc.id,
            type: "function",
            function: tc.function,
          })
        ),
      });
    } else {
      const messageOutput: MessageOutput = {
        id: generateId("msg"),
        type: "message",
        role: "assistant",
        status: "completed",
        content: transformMessageContent(message.content as unknown as Record<string, unknown>[] | undefined),
      };
      output.push(messageOutput);
    }
  }
  return {
    id: generateId("resp"),
    object: "response",
    created: ccResponse.created,
    model: ccResponse.model,
    status: "completed",
    output,
    usage: transformUsage(ccResponse.usage),
  };
}

/** Transform message content to OutputContent[] */
function transformMessageContent(
  content: string | Record<string, unknown>[] | undefined
): OutputContent[] {
  if (!content) return [];
  if (typeof content === "string") {
    return [{ type: "output_text", text: content }];
  }
  // Array of content parts - extract text
  const text = content
    .map((p) => (p as Record<string, unknown>).text ?? "")
    .join("");
  return text ? [{ type: "output_text", text }] : [];
}

/** Map Chat Completions usage to Response API usage */
function transformUsage(
  usage: ChatCompletionResponse["usage"]
): ResponseObject["usage"] {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}