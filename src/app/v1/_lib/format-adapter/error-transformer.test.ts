import { describe, it, expect } from "vitest";
import { transformError, transformErrorRuntime } from "./error-transformer";

describe("transformError", () => {
  it("should convert Chat Completions error to Response API format", () => {
    const ccError = {
      error: {
        message: "Invalid API key provided.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    };

    const result = transformError(ccError as unknown as Parameters<typeof transformError>[0]);

    expect(result.error.type).toBe("invalid_request_error");
    expect(result.error.code).toBe("invalid_api_key");
    expect(result.error.message).toBe("Invalid API key provided.");
  });

  it("should default type to invalid_request_error when missing", () => {
    const ccError = {
      error: {
        message: "Something went wrong",
      },
    };

    const result = transformError(ccError as unknown as Parameters<typeof transformError>[0]);

    expect(result.error.type).toBe("invalid_request_error");
  });
});

describe("transformErrorRuntime", () => {
  it("should handle arbitrary error objects", () => {
    const error = {
      error: {
        type: "rate_limit_exceeded",
        message: "Rate limit exceeded. Please retry after 60 seconds.",
      },
    };

    const result = transformErrorRuntime(error);

    expect((result as any).error?.type).toBe("rate_limit_exceeded");
  });

  it("should handle errors without error wrapper", () => {
    const error = "Network timeout";

    const result: Record<string, unknown> = transformErrorRuntime(error as unknown as Record<string, unknown>);

    expect((result as any).error?.type).toBe("invalid_request_error");
    expect((result as any).error?.message).toBe("Network timeout");
  });
});