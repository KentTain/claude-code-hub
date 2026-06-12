/**
 * SSE 流式转换器：Chat Completions SSE -> Response API SSE
 *
 * 将上游 Chat Completions 格式的流式 SSE 事件实时转换为
 * Response API 格式的事件流，供 Codex 客户端消费。
 */

import type { ChatCompletionChunk } from "../codex/types/compatible";
import type {
  ResponseObject,
  OutputItem,
  MessageOutput,
  ToolCallsOutput,
  ToolCall,
  OutputContent,
} from "../codex/types/response";
import { generateId } from "./types";

// ============ SSE 行缓冲 ============

/**
 * 将 Uint8Array 按行拆分，处理跨 chunk 的不完整行。
 * SSE 协议以 \n 分隔行，\n\n 分隔事件。
 */
class LineBuffer {
  private buffer = "";

  /** 将新数据追加到缓冲区，返回完整的行 */
  append(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      lines.push(this.buffer.substring(0, idx));
      this.buffer = this.buffer.substring(idx + 1);
    }
    return lines;
  }

  /** 取出缓冲区中剩余的不完整行 */
  flush(): string | undefined {
    if (this.buffer.length === 0) return undefined;
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }
}

// ============ 事件解析 ============

interface ParsedSSEEvent {
  event?: string;
  data: string;
}

/**
 * 将 SSE 文本行解析为事件对象。
 * 支持标准 SSE 格式：
 *   event: xxx
 *   data: yyy
 * 以及简写格式（只有 data 行）。
 */
function parseSSELines(lines: string[]): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  let currentEvent: Partial<ParsedSSEEvent> = {};
  let currentDataLines: string[] = [];

  for (const line of lines) {
    // 空行 = 事件边界
    if (line.trim() === "") {
      if (currentDataLines.length > 0 || currentEvent.event) {
        events.push({
          event: currentEvent.event,
          data: currentDataLines.join("\n"),
        });
      }
      currentEvent = {};
      currentDataLines = [];
      continue;
    }

    // event: 行
    if (line.startsWith("event:")) {
      currentEvent.event = line.substring(6).trim();
      continue;
    }

    // data: 行
    if (line.startsWith("data:")) {
      currentDataLines.push(line.substring(5).trimStart());
      continue;
    }

    // data 行没有冒号空格的简写格式
    if (line.startsWith("data ")) {
      currentDataLines.push(line.substring(5));
      continue;
    }

    // 忽略 id:、retry: 等其他 SSE 字段
  }

  // 处理末尾没有空行的事件
  if (currentDataLines.length > 0 || currentEvent.event) {
    events.push({
      event: currentEvent.event,
      data: currentDataLines.join("\n"),
    });
  }

  return events;
}

// ============ 工具调用增量累积器 ============

interface AccumulatedToolCall {
  id: string;
  type: string;
  functionName: string;
  argumentsChunks: string[];
}

// ============ 主转换器 ============

/**
 * Chat Completions SSE -> Response API SSE TransformStream
 *
 * 事件映射：
 * | Chat Completions                    | Response API                        |
 * |-------------------------------------|-------------------------------------|
 * | 首 chunk (delta.role=assistant)     | event: response.created             |
 * | delta.content                       | event: response.output_text.delta   |
 * | delta.tool_calls                    | event: response.tool_calls.delta    |
 * | finish_reason != null               | event: response.completed           |
 * | data: [DONE]                        | (吞掉，不转发)                      |
 */
export class ChatCompletionsToResponseSseTransformer {
  private responseId: string;
  private msgItemId: string;
  private toolCallsItemId: string;
  private model: string;
  private created: number;

  // 累积文本内容，用于构建 response.completed 的 output
  private textContent = "";
  // 累积工具调用
  private toolCalls: AccumulatedToolCall[] = [];
  // 是否已发送 response.created
  private createdSent = false;
  // 行缓冲器
  private lineBuffer = new LineBuffer();
  // 待处理的事件行（跨 chunk 缓冲）
  private pendingLines: string[] = [];
  // 上游 usage（可能出现在最后一个 chunk）
  private usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

  constructor() {
    this.responseId = generateId("resp");
    this.msgItemId = generateId("msg");
    this.toolCallsItemId = generateId("tc");
    this.model = "";
    this.created = Math.floor(Date.now() / 1000);
  }

  /**
   * 创建 TransformStream<Uint8Array, Uint8Array>
   * 可直接 pipeThrough 到响应流中。
   */
  createStream(): TransformStream<Uint8Array, Uint8Array> {
    const self = this;

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk, { stream: true });
        const output = self.processChunk(text);
        if (output.length > 0) {
          controller.enqueue(new TextEncoder().encode(output));
        }
      },
      flush(controller) {
        const output = self.flush();
        if (output.length > 0) {
          controller.enqueue(new TextEncoder().encode(output));
        }
      },
    });
  }

  /**
   * 处理一个 chunk，返回要发送给客户端的 SSE 文本
   */
  processChunk(text: string): string {
    const lines = this.lineBuffer.append(text);
    this.pendingLines.push(...lines);

    // 尝试按空行分组解析完整事件
    return this.processPendingLines();
  }

  /**
   * 冲刷缓冲区中剩余数据
   */
  flush(): string {
    const remaining = this.lineBuffer.flush();
    if (remaining) {
      this.pendingLines.push(remaining);
    }
    // 添加空行触发最后一个事件解析
    this.pendingLines.push("");
    return this.processPendingLines();
  }

  private processPendingLines(): string {
    const outputs: string[] = [];

    // 按空行分组
    let groupStart = 0;
    for (let i = 0; i < this.pendingLines.length; i++) {
      if (this.pendingLines[i].trim() === "") {
        if (i > groupStart) {
          const groupLines = this.pendingLines.slice(groupStart, i);
          const events = parseSSELines(groupLines);
          for (const event of events) {
            const output = this.handleSSEEvent(event);
            if (output) outputs.push(output);
          }
        }
        groupStart = i + 1;
      }
    }

    // 保留未处理的行（不完整的组）
    this.pendingLines =
      groupStart < this.pendingLines.length
        ? this.pendingLines.slice(groupStart)
        : [];

    return outputs.join("");
  }

  /**
   * 处理单个解析出的 SSE 事件
   */
  private handleSSEEvent(event: ParsedSSEEvent): string | null {
    const { data } = event;

    // 忽略 [DONE] 标记
    if (data.trim() === "[DONE]") {
      return null;
    }

    // 解析 JSON
    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      // 非 JSON 数据，忽略
      return null;
    }

    // 更新 model
    if (chunk.model) {
      this.model = chunk.model;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return null;

    const outputs: string[] = [];

    // 提取 usage（某些供应商在最后一个 chunk 带上 usage）
    const chunkAny = chunk as unknown as Record<string, unknown>;
    if (chunkAny.usage) {
      this.usage = chunkAny.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }

    const delta = choice.delta as Record<string, unknown>;

    // 首 chunk：发送 response.created
    if (!this.createdSent) {
      this.createdSent = true;
      outputs.push(this.emitResponseCreated());
    }

    // delta.tool_calls
    if (delta.tool_calls) {
      const toolCallsDelta = delta.tool_calls as Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;

      for (const tc of toolCallsDelta) {
        const idx = tc.index ?? this.toolCalls.length;

        // 新工具调用
        if (tc.id || !this.toolCalls[idx]) {
          this.toolCalls[idx] = {
            id: tc.id ?? generateId("tc_call"),
            type: tc.type ?? "function",
            functionName: tc.function?.name ?? "",
            argumentsChunks: [],
          };
        }

        // 累积 function name
        if (tc.function?.name) {
          this.toolCalls[idx].functionName += tc.function.name;
        }

        // 累积 arguments
        if (tc.function?.arguments) {
          this.toolCalls[idx].argumentsChunks.push(tc.function.arguments);
        }

        // 发送 tool_calls delta 事件
        outputs.push(this.emitToolCallsDelta(idx, tc));
      }
    }

    // delta.content
    if (typeof delta.content === "string" && delta.content !== "") {
      this.textContent += delta.content;
      outputs.push(this.emitOutputTextDelta(delta.content));
    }

    // finish_reason
    if (choice.finish_reason) {
      outputs.push(this.emitResponseCompleted(choice.finish_reason));
    }

    return outputs.length > 0 ? outputs.join("") : null;
  }

  // ============ 事件发射器 ============

  private emitResponseCreated(): string {
    const responseObject: Partial<ResponseObject> = {
      id: this.responseId,
      object: "response",
      created: this.created,
      model: this.model,
      status: "incomplete",
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };

    return (
      "event: response.created\n" +
      "data: " + JSON.stringify(responseObject) + "\n\n"
    );
  }

  private emitOutputTextDelta(text: string): string {
    const event = {
      type: "response.output_text.delta",
      item_id: this.msgItemId,
      delta: text,
    };

    return (
      "event: response.output_text.delta\n" +
      "data: " + JSON.stringify(event) + "\n\n"
    );
  }

  private emitToolCallsDelta(
    index: number,
    tc: {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }
  ): string {
    const event = {
      type: "response.tool_calls.delta",
      item_id: this.toolCallsItemId,
      delta: {
        tool_call_index: index,
        id: tc.id,
        type: tc.type,
        function: tc.function,
      },
    };

    return (
      "event: response.tool_calls.delta\n" +
      "data: " + JSON.stringify(event) + "\n\n"
    );
  }

  private emitResponseCompleted(finishReason: string): string {
    const output: OutputItem[] = [];

    // 如果有文本内容，添加 message 输出项
    if (this.textContent || this.toolCalls.length === 0) {
      const content: OutputContent[] = this.textContent
        ? [{ type: "output_text", text: this.textContent }]
        : [];
      const msgOutput: MessageOutput = {
        id: this.msgItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content,
      };
      output.push(msgOutput);
    }

    // 如果有工具调用，添加 tool_calls 输出项
    if (this.toolCalls.length > 0) {
      const toolCalls: ToolCall[] = this.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.functionName,
          arguments: tc.argumentsChunks.join(""),
        },
      }));
      const tcOutput: ToolCallsOutput = {
        id: this.toolCallsItemId,
        type: "tool_calls",
        tool_calls: toolCalls,
      };
      output.push(tcOutput);
    }

    const status = finishReason === "stop" ? "completed" : "incomplete";

    const responseObject: Partial<ResponseObject> = {
      id: this.responseId,
      object: "response",
      created: this.created,
      model: this.model,
      status,
      output,
      usage: this.usage
        ? {
            input_tokens: this.usage.prompt_tokens ?? 0,
            output_tokens: this.usage.completion_tokens ?? 0,
            total_tokens: this.usage.total_tokens ?? 0,
          }
        : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };

    return (
      "event: response.completed\n" +
      "data: " + JSON.stringify(responseObject) + "\n\n"
    );
  }
}

/**
 * 便捷函数：创建 SSE 转换 TransformStream
 */
export function createSseTransformStream(): TransformStream<Uint8Array, Uint8Array> {
  const transformer = new ChatCompletionsToResponseSseTransformer();
  return transformer.createStream();
}