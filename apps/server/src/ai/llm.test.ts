import { describe, expect, it } from "vitest";
import { anthropicAdapter, chatAdapter, openAiAdapter, toAnthropicMessages, toOpenAiMessages, type HistoryMessage } from "./llm";
import type { StoredProvider } from "./secrets";
import { cleanSvg } from "./svg";
import { anthropicSse, openAiSse } from "./testing/fake-provider";
import { jsonResponse, mockFetch, sseResponse } from "./testing/mock-fetch";

const anthropic: StoredProvider = { id: "a", kind: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", imageModel: "", chatModel: "claude-opus-5-5", apiKey: "sk-ant-test-9876" };
const compatible: StoredProvider = { id: "o", kind: "openai-compatible", label: "Ollama", baseUrl: "http://localhost:11434/v1", imageModel: "", chatModel: "qwen3", apiKey: "" };

const history: HistoryMessage[] = [
  { role: "user", content: [{ type: "text", text: "Make a card" }] },
  { role: "assistant", text: "Looking first.", toolCalls: [{ id: "toolu_1", name: "get_screenshot", input: { fileId: "F", nodeId: "1-a" } }] },
  { role: "tool", results: [{ id: "toolu_1", name: "get_screenshot", isError: false, content: [{ type: "text", text: "{\"file\":{}}" }, { type: "image", data: "AAAA", mimeType: "image/png" }] }] },
];

const tools = [{ name: "get_screenshot", description: "Render a node", schema: { type: "object", properties: { nodeId: { type: "string" } }, required: ["nodeId"] } }];

describe("Anthropic adapter", () => {
  it("converts history: tool results carry images, raw assistant content is replayed unchanged", () => {
    const out = toAnthropicMessages(history);
    expect(out[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Looking first." }, { type: "tool_use", id: "toolu_1", name: "get_screenshot", input: { fileId: "F", nodeId: "1-a" } }] });
    expect(out[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: undefined, content: [{ type: "text", text: "{\"file\":{}}" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }],
    });
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "hi" }];
    expect(toAnthropicMessages([{ role: "assistant", text: "hi", toolCalls: [], anthropic: raw }])[0]!.content).toBe(raw);
  });

  it("streams text and tool calls through the official SDK with current params", async () => {
    const f = mockFetch(() => sseResponse(anthropicSse({ text: "Checking the card.", toolCalls: [{ name: "get_screenshot", input: { nodeId: "1-a" } }] }, "claude-opus-5-5")));
    const deltas: string[] = [];
    const res = await anthropicAdapter(anthropic, { fetch: f }).stream({ model: "claude-opus-5-5", system: "SYS", messages: history, tools }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("Checking the card.");
    expect(res.text).toBe("Checking the card.");
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ id: expect.any(String), name: "get_screenshot", input: { nodeId: "1-a" } }]);
    expect(res.anthropic).toHaveLength(2);

    const call = f.calls[0]!;
    expect(call.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(call.method).toBe("POST");
    expect(call.headers["x-api-key"]).toBe("sk-ant-test-9876");
    expect(call.headers["anthropic-version"]).toBeTruthy();
    expect(call.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    const body = call.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      stream: true,
      system: [{ type: "text", text: "SYS" }],
      cache_control: { type: "ephemeral" },
      output_config: { effort: "high" },
      fallbacks: "default",
    });
    expect(body.thinking).toBeUndefined();
    expect(body.betas).toBeUndefined();
    expect((body.tools as Array<Record<string, unknown>>)[0]).toEqual({ name: "get_screenshot", description: "Render a node", input_schema: tools[0]!.schema, eager_input_streaming: true });
  });

  it("skips refusal fallbacks for other base URLs and models", async () => {
    const f = mockFetch(() => sseResponse(anthropicSse({ text: "ok", toolCalls: [] }, "m")));
    await anthropicAdapter({ ...anthropic, baseUrl: "http://127.0.0.1:9" }, { fetch: f }).stream({ model: "claude-opus-5-5", system: "S", messages: history.slice(0, 1), tools: [] }, () => {});
    await anthropicAdapter(anthropic, { fetch: f }).stream({ model: "claude-haiku-5-5", system: "S", messages: history.slice(0, 1), tools: [] }, () => {});
    for (const c of f.calls) {
      expect((c.body as Record<string, unknown>).fallbacks).toBeUndefined();
      expect(c.headers["anthropic-beta"]).toBeUndefined();
    }
    expect(f.calls[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:9\/v1\/messages/);
  });

  it("reports API errors with the provider message", async () => {
    const f = mockFetch(() => jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
    await expect(anthropicAdapter(anthropic, { fetch: f }).stream({ model: "claude-opus-5-5", system: "S", messages: history.slice(0, 1), tools: [] }, () => {})).rejects.toThrow(
      /Anthropic answered 401: invalid x-api-key/,
    );
  });

  it("needs a key", () => {
    expect(() => chatAdapter({ ...anthropic, apiKey: "" })).toThrow(/no API key/);
  });
});

describe("OpenAI-compatible adapter", () => {
  it("converts history: tool messages are text, images follow as one user message", () => {
    const out = toOpenAiMessages("SYS", history);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: "Make a card" });
    expect(out[2]).toEqual({ role: "assistant", content: "Looking first.", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "get_screenshot", arguments: '{"fileId":"F","nodeId":"1-a"}' } }] });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "toolu_1", content: '{"file":{}}\n\n[image attached in the next message]' });
    expect(out[4]).toEqual({ role: "user", content: [{ type: "text", text: "Images returned by the tool calls above:" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] });
  });

  it("streams chat completions and assembles tool call fragments", async () => {
    const f = mockFetch(() => sseResponse(openAiSse({ text: "On it.", toolCalls: [{ name: "get_screenshot", input: { nodeId: "1-a", scale: 2 } }] }, "qwen3")));
    const deltas: string[] = [];
    const res = await openAiAdapter(compatible, { fetch: f }).stream({ model: "qwen3", system: "SYS", messages: history.slice(0, 1), tools }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("On it.");
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ id: expect.stringMatching(/^call_/), name: "get_screenshot", input: { nodeId: "1-a", scale: 2 } }]);
    const call = f.calls[0]!;
    expect(call.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(call.headers.authorization).toBeUndefined();
    expect(call.body).toMatchObject({ model: "qwen3", stream: true, tools: [{ type: "function", function: { name: "get_screenshot", description: "Render a node", parameters: tools[0]!.schema } }] });
  });

  it("handles servers that ignore stream: true, and bad tool JSON", async () => {
    const f = mockFetch(() =>
      jsonResponse({ choices: [{ message: { content: "Hi", tool_calls: [{ id: "c1", function: { name: "get_screenshot", arguments: "{oops" } }] }, finish_reason: "tool_calls" }] }),
    );
    const res = await openAiAdapter({ ...compatible, apiKey: "sk-or-1" }, { fetch: f }).stream({ model: "m", system: "S", messages: history.slice(0, 1), tools }, () => {});
    expect(f.calls[0]!.headers.authorization).toBe("Bearer sk-or-1");
    expect(res.text).toBe("Hi");
    expect(res.toolCalls[0]).toMatchObject({ id: "c1", name: "get_screenshot", input: {}, parseError: "The arguments were not valid JSON." });
  });

  it("maps finish reasons and errors", async () => {
    const f = mockFetch(() => sseResponse(`data: ${JSON.stringify({ choices: [{ delta: { content: "cut" }, finish_reason: "length" }] })}\n\ndata: [DONE]\n\n`));
    expect((await openAiAdapter(compatible, { fetch: f }).stream({ model: "m", system: "S", messages: history.slice(0, 1), tools: [] }, () => {})).stopReason).toBe("max_tokens");
    const g = mockFetch(() => jsonResponse({ error: { message: "model 'nope' not found" } }, 404));
    await expect(openAiAdapter(compatible, { fetch: g }).stream({ model: "nope", system: "S", messages: history.slice(0, 1), tools: [] }, () => {})).rejects.toThrow("Ollama answered 404: model 'nope' not found.");
  });
});

describe("cleanSvg", () => {
  it("keeps one svg and strips anything active", () => {
    const out = cleanSvg('Sure!\n```svg\n<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><a href="javascript:evil()"><rect width="10" height="10" onclick="y"/></a><image href="http://x/y.png"/><foreignObject><div/></foreignObject></svg>\n```');
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="#"><rect width="10" height="10"/></a></svg>');
    expect(() => cleanSvg("I cannot draw that.")).toThrow(/did not return an SVG/);
  });
});
