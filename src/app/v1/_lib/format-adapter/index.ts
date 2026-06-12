/**
 * Format Adapter 模块入口
 *
 * 提供 Response API <-> Chat Completions 格式转换功能。
 */

// 类型导出
export type { UpstreamFormat, FormatAdapter, IdGenerator } from "./types";

// ID 生成函数
export {
  generateId,
  generateResponseId,
  generateMessageItemId,
  generateToolCallsItemId,
} from "./types";

// 请求转换
export {
  transformRequestToChatCompletions,
  needsRequestTransform,
} from "./request-transformer";

// 响应转换
export { transformResponse } from "./response-transformer";

// 错误转换
export { transformError, transformErrorRuntime } from "./error-transformer";

// SSE 流式转换
export {
  ChatCompletionsToResponseSseTransformer,
  createSseTransformStream,
} from "./sse-transformer";

// FormatAdapter 实现
import type { UpstreamFormat, FormatAdapter } from "./types";
import { transformRequestToChatCompletions } from "./request-transformer";
import { transformResponse } from "./response-transformer";
import { transformErrorRuntime } from "./error-transformer";

/**
 * 默认 FormatAdapter 实现
 *
 * 用于处理 Response API <-> Chat Completions 格式转换。
 */
export const defaultFormatAdapter: FormatAdapter = {
  needsTransform(upstreamFormat: UpstreamFormat): boolean {
    return upstreamFormat === "chatcompletions";
  },

  transformRequest(body: Record<string, unknown>): Record<string, unknown> {
    return transformRequestToChatCompletions(
      body as unknown as unknown as Parameters<typeof transformRequestToChatCompletions>[0]
    ) as Record<string, unknown>;
  },

  transformResponse(body: Record<string, unknown>): Record<string, unknown> {
    return transformResponse(
      body as unknown as unknown as Parameters<typeof transformResponse>[0]
    ) as unknown as Record<string, unknown>;
  },

  transformError(body: Record<string, unknown>): Record<string, unknown> {
    return transformErrorRuntime(body);
  },
};

/**
 * 创建格式转换器实例
 *
 * @param upstreamFormat - 上游供应商支持的格式
 * @returns FormatAdapter 实例，如果不需要转换则返回 null
 */
export function createFormatAdapter(
  upstreamFormat: UpstreamFormat
): FormatAdapter | null {
  if (upstreamFormat === "response") {
    // 上游支持 Response API，无需转换
    return null;
  }
  return defaultFormatAdapter;
}