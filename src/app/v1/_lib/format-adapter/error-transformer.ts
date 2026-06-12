/**
 * Chat Completions -> Response API 错误格式转换器
 */

/** Chat Completions 错误格式 */
export interface ChatCompletionsError {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}

/** Response API 错误格式 */
export interface ResponseApiError {
  error: {
    type: string;
    code?: string;
    message: string;
  };
}

/** 将 Chat Completions 错误转换为 Response API 错误格式 */
export function transformError(ccError: ChatCompletionsError): ResponseApiError {
  const { error } = ccError;
  return {
    error: {
      type: error.type ?? "invalid_request_error",
      code: error.code ?? undefined,
      message: error.message,
    },
  };
}

/** 运行时错误转换（接受任意对象） */
export function transformErrorRuntime(error: Record<string, unknown>): Record<string, unknown> {
  const err = error.error as Record<string, unknown> | undefined;
  if (!err) {
    return {
      error: {
        type: "invalid_request_error",
        message: String(error),
      },
    };
  }
  return {
    error: {
      type: (err.type as string) ?? "invalid_request_error",
      code: err.code as string | undefined,
      message: String(err.message ?? ""),
    },
  };
}