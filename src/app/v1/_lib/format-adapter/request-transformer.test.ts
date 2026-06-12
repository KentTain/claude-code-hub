import { describe, it, expect } from "vitest";
import { transformRequestToChatCompletions } from "./request-transformer";
import type { ResponseRequest } from "../codex/types/response";

describe("transformRequestToChatCompletions", () => {
  it("should convert basic request with input messages", () => {
    const request: ResponseRequest = {
      model: "gpt-4",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Hello" }] },
      ],
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.model).toBe("gpt-4");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Hello",
    });
  });

  it("should convert instructions to system message", () => {
    const request: ResponseRequest = {
      model: "gpt-4",
      instructions: "You are a helpful assistant.",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Hi" }] },
      ],
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(result.messages[1]).toEqual({
      role: "user",
      content: "Hi",
    });
  });

  it("should convert tool_outputs to role:tool messages", () => {
    const request: ResponseRequest = {
      model: "gpt-4",
      input: [
        { role: "user", content: [{ type: "input_text", text: "What is the weather?" }] },
        {
          type: "tool_outputs",
          outputs: [
            { call_id: "call_123", output: "Sunny, 25°C" },
          ],
        },
      ],
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "Sunny, 25°C",
    });
  });

  it("should convert developer role to system", () => {
    const request: ResponseRequest = {
      model: "gpt-4",
      input: [
        { role: "developer", content: [{ type: "input_text", text: "Be concise" }] },
      ],
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.messages[0].role).toBe("system");
  });

  it("should pass through common parameters", () => {
    const request: ResponseRequest = {
      model: "gpt-4",
      input: [{ role: "user", content: [{ type: "input_text", text: "Test" }] }],
      temperature: 0.7,
      top_p: 0.9,
      max_output_tokens: 1000,
      stream: true,
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.max_tokens).toBe(1000);
    expect(result.stream).toBe(true);
  });

  it("should handle multi-modal content with image", () => {
    const request: ResponseRequest = {
      model: "gpt-4-vision",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "What is in this image?" },
            { type: "input_image", image_url: "https://example.com/image.png" },
          ],
        },
      ],
    };

    const result = transformRequestToChatCompletions(request);

    expect(result.messages[0].content).toEqual([
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: "https://example.com/image.png" } },
    ]);
  });
});