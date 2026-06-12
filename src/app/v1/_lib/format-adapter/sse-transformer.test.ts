import { describe, it, expect } from "vitest";
import { ChatCompletionsToResponseSseTransformer } from "./sse-transformer";

describe("ChatCompletionsToResponseSseTransformer", () => {
  it("should emit response.created on first chunk", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    const chunk = "data: " + JSON.stringify({
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      }],
    }) + "\n\n";

    const result = transformer.processChunk(chunk);

    expect(result).toContain("event: response.created");
    expect(result).toContain('"status":"incomplete"');
  });

  it("should emit output_text.delta for content", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    // First chunk to initialize
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");

    const contentChunk = "data: " + JSON.stringify({
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{
        index: 0,
        delta: { content: "Hello" },
        finish_reason: null,
      }],
    }) + "\n\n";

    const result = transformer.processChunk(contentChunk);

    expect(result).toContain("event: response.output_text.delta");
    expect(result).toContain('"delta":"Hello"');
  });

  it("should emit response.completed with finish_reason", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    // Initialize
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");

    // Content
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    }) + "\n\n");

    // Finish
    const finishChunk = "data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }) + "\n\n";

    const result = transformer.processChunk(finishChunk);

    expect(result).toContain("event: response.completed");
    expect(result).toContain('"status":"completed"');
    expect(result).toContain('"input_tokens":10');
    expect(result).toContain('"output_tokens":5');
  });

  it("should ignore data: [DONE]", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");

    const result = transformer.processChunk("data: [DONE]\n\n");

    expect(result).toBe("");
  });

  it("should handle tool_calls delta", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");

    const toolCallChunk = "data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_abc",
            type: "function",
            function: { name: "get_weather", arguments: "{\"loc" },
          }],
        },
        finish_reason: null,
      }],
    }) + "\n\n";

    const result = transformer.processChunk(toolCallChunk);

    expect(result).toContain("event: response.tool_calls.delta");
  });

  it("should accumulate text content for response.completed", () => {
    const transformer = new ChatCompletionsToResponseSseTransformer();
    
    transformer.processChunk("data: " + JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");

    transformer.processChunk("data: " + JSON.stringify({
      model: "gpt-4",
      choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }],
    }) + "\n\n");

    transformer.processChunk("data: " + JSON.stringify({
      model: "gpt-4",
      choices: [{ index: 0, delta: { content: "World!" }, finish_reason: null }],
    }) + "\n\n");

    const result = transformer.processChunk("data: " + JSON.stringify({
      model: "gpt-4",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    }) + "\n\n");

    expect(result).toContain('"text":"Hello World!"');
  });
});