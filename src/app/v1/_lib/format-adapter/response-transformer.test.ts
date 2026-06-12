import { describe, it, expect } from "vitest";
import { transformResponse } from "./response-transformer";
import type { ChatCompletionResponse } from "../codex/types/compatible";

describe("transformResponse", () => {
  it("should convert basic Chat Completions response to Response API format", () => {
    const ccResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello, how can I help you?",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    const result = transformResponse(ccResponse);

    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.model).toBe("gpt-4");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("message");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(20);
  });

  it("should handle tool_calls in response", () => {
    const ccResponse = {
      id: "chatcmpl-123",
      object: "chat.completion" as const,
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location": "Beijing"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls" as const,
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 10,
        total_tokens: 25,
      },
    } as unknown as ChatCompletionResponse;

    const result = transformResponse(ccResponse);

    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("tool_calls");
    if (result.output[0].type === "tool_calls") {
      expect(result.output[0].tool_calls).toHaveLength(1);
      expect(result.output[0].tool_calls[0].function.name).toBe("get_weather");
    }
  });

  it("should generate unique IDs with correct prefixes", () => {
    const ccResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Test" },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    const result1 = transformResponse(ccResponse);
    const result2 = transformResponse(ccResponse);

    // Response IDs should be unique
    expect(result1.id).toMatch(/^resp_[a-zA-Z0-9]{24}$/);
    expect(result2.id).toMatch(/^resp_[a-zA-Z0-9]{24}$/);
    expect(result1.id).not.toBe(result2.id);

    // Message IDs should be unique
    expect(result1.output[0].id).toMatch(/^msg_[a-zA-Z0-9]{24}$/);
  });
});