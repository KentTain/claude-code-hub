/**
 * Format Adapter 类型定义
 *
 * Response API <-> Chat Completions 格式转换器的共享类型和接口
 */

/** 上游供应商支持的请求格式 */
export type UpstreamFormat = "response" | "chatcompletions";

/** 格式转换器接口 */
export interface FormatAdapter {
  /** 是否需要格式转换 */
  needsTransform(upstreamFormat: UpstreamFormat): boolean;
  /** 将 Response API 请求体转换为 Chat Completions 格式 */
  transformRequest(body: Record<string, unknown>): Record<string, unknown>;
  /** 将 Chat Completions 非流式响应转换为 Response API 格式 */
  transformResponse(body: Record<string, unknown>): Record<string, unknown>;
  /** 将 Chat Completions 错误响应转换为 Response API 格式 */
  transformError(body: Record<string, unknown>): Record<string, unknown>;
}

/** ID 生成器接口 */
export interface IdGenerator {
  generateResponseId(): string;
  generateItemId(): string;
}

// ============ ID 生成函数 ============

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 24;

/**
 * 生成随机字符串后缀
 */
function randomSuffix(length: number = ID_LENGTH): string {
  let result = "";
  const randomValues = new Uint8Array(length);
  // 使用 crypto.getRandomValues 生成密码学安全的随机数
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Node.js 环境回退
    for (let i = 0; i < length; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < length; i++) {
    result += CHARS[randomValues[i] % CHARS.length];
  }
  return result;
}

/**
 * 生成带前缀的唯一 ID
 * @param prefix - ID 前缀（如 "resp", "msg", "tc"）
 * @returns 格式为 "{prefix}_{random}" 的唯一 ID
 */
export function generateId(prefix: string): string {
  return `${prefix}_${randomSuffix()}`;
}

/**
 * 生成 Response ID（resp_ 前缀）
 */
export function generateResponseId(): string {
  return generateId("resp");
}

/**
 * 生成 Message Item ID（msg_ 前缀）
 */
export function generateMessageItemId(): string {
  return generateId("msg");
}

/**
 * 生成 Tool Calls Item ID（tc_ 前缀）
 */
export function generateToolCallsItemId(): string {
  return generateId("tc");
}