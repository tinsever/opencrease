// Chat model adapters for the in-app agent and SVG generation: Anthropic Messages (official SDK) and
// OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama, LM Studio). Both stream text and tool calls.
// The conversation is kept in a neutral shape; Anthropic turns also keep their raw content blocks so
// thinking and fallback blocks go back to the API unchanged (append-only history).
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { checkResponse, joinUrl, ProviderError, type FetchLike } from "./http-util";
import type { StoredProvider } from "./secrets";

export type HistoryBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** the model's arguments were not valid JSON */
  parseError?: string;
}

export interface ToolResultMessage {
  id: string;
  name: string;
  content: HistoryBlock[];
  isError: boolean;
}

export type HistoryMessage =
  | { role: "user"; content: HistoryBlock[] }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; anthropic?: unknown[] }
  | { role: "tool"; results: ToolResultMessage[] };

export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: HistoryMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | (string & {});

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** raw assistant content (Anthropic only), to be replayed unchanged */
  anthropic?: unknown[];
}

export interface ChatAdapter {
  stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult>;
}

export interface AdapterOptions {
  fetch?: FetchLike;
}

// ------------------------------------------------------------------------------------- Anthropic

/** Models that accept server-side refusal fallbacks in the "default" routing form. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"]);

function isOfficialAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

function anthropicBlocks(blocks: HistoryBlock[]): Array<Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam> {
  return blocks.map((b) =>
    b.type === "text"
      ? { type: "text" as const, text: b.text || " " }
      : { type: "image" as const, source: { type: "base64" as const, media_type: b.mimeType as "image/png", data: b.data } },
  );
}

export function toAnthropicMessages(messages: HistoryMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: anthropicBlocks(m.content) });
    else if (m.role === "assistant") {
      if (m.anthropic) {
        out.push({ role: "assistant", content: m.anthropic as BetaContentBlockParam[] });
        continue;
      }
      const content: BetaContentBlockParam[] = [];
      if (m.text.trim()) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      if (content.length) out.push({ role: "assistant", content });
    } else {
      const content: BetaToolResultBlockParam[] = m.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        is_error: r.isError || undefined,
        content: anthropicBlocks(r.content.length ? r.content : [{ type: "text", text: "(no output)" }]),
      }));
      out.push({ role: "user", content });
    }
  }
  return out;
}

export function anthropicAdapter(p: StoredProvider, opts: AdapterOptions = {}): ChatAdapter {
  if (!p.apiKey) throw new ProviderError(`${p.label} has no API key. Add one in Settings, AI providers.`);
  const client = new Anthropic({
    apiKey: p.apiKey,
    baseURL: p.baseUrl || "https://api.anthropic.com",
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch as unknown as typeof fetch } : {}),
  });
  const official = isOfficialAnthropic(p.baseUrl || "https://api.anthropic.com");
  return {
    async stream(req, onText) {
      const fallback = official && FALLBACK_MODELS.has(req.model);
      const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: req.maxTokens ?? 64000,
        system: [{ type: "text", text: req.system }],
        messages: toAnthropicMessages(req.messages),
        cache_control: { type: "ephemeral" },
        output_config: { effort: "high" },
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
                eager_input_streaming: true,
              })),
            }
          : {}),
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };
      // a tool input that is not parseable JSON rejects finalMessage(); re-issue that turn (API errors are rethrown)
      for (let attempt = 0; ; attempt++) {
        const stream = client.beta.messages.stream(params, { signal: req.signal });
        stream.on("text", (delta) => onText(delta));
        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          if (err instanceof Anthropic.APIUserAbortError || req.signal?.aborted) throw err;
          if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic answered ${err.status ?? "with an error"}: ${anthropicMessage(err)}`, err.status);
          if (attempt >= 2) throw err;
          continue;
        }
        const content = message.content as BetaContentBlock[];
        const text = content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
        const toolCalls: ToolCall[] = content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> }));
        return { text, toolCalls, stopReason: message.stop_reason ?? "end_turn", anthropic: content };
      }
    },
  };
}

function anthropicMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: string } } | undefined;
  const msg = body?.error?.message ?? err.message;
  const hint = err.status === 401 ? " Check the API key in Settings, AI providers." : "";
  return `${msg}${hint}`;
}

// ------------------------------------------------------------------------------------- OpenAI-compatible

type OaContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type OaMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OaContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

function oaUserContent(blocks: HistoryBlock[]): string | OaContentPart[] {
  if (blocks.every((b) => b.type === "text")) return blocks.map((b) => (b as { text: string }).text).join("\n\n");
  return blocks.map((b) => (b.type === "text" ? { type: "text" as const, text: b.text } : { type: "image_url" as const, image_url: { url: `data:${b.mimeType};base64,${b.data}` } }));
}

export function toOpenAiMessages(system: string, messages: HistoryMessage[]): OaMessage[] {
  const out: OaMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: oaUserContent(m.content) });
    else if (m.role === "assistant") {
      const msg: OaMessage = { role: "assistant", content: m.text || null };
      if (m.toolCalls.length) msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } }));
      out.push(msg);
    } else {
      // tool messages carry text only; images follow in one user message
      const images: OaContentPart[] = [];
      for (const r of m.results) {
        const texts = r.content.map((b) => (b.type === "text" ? b.text : "[image attached in the next message]"));
        for (const b of r.content) if (b.type === "image") images.push({ type: "image_url", image_url: { url: `data:${b.mimeType};base64,${b.data}` } });
        out.push({ role: "tool", tool_call_id: r.id, content: (r.isError ? "Error: " : "") + (texts.join("\n\n") || "(no output)") });
      }
      if (images.length) out.push({ role: "user", content: [{ type: "text", text: "Images returned by the tool calls above:" }, ...images] });
    }
  }
  return out;
}

/** Read an SSE body line by line and yield the JSON payload of each `data:` line. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trim();
}

const FINISH: Record<string, StopReason> = { stop: "end_turn", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "refusal" };

export function openAiAdapter(p: StoredProvider, opts: AdapterOptions = {}): ChatAdapter {
  const doFetch = opts.fetch ?? fetch;
  const who = p.label || "The chat provider";
  return {
    async stream(req, onText) {
      const body: Record<string, unknown> = { model: req.model, messages: toOpenAiMessages(req.system, req.messages), stream: true };
      if (req.tools.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
      let res: Response;
      try {
        res = await doFetch(joinUrl(p.baseUrl, "chat/completions"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream", ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
        throw new ProviderError(`Could not reach ${who} at ${p.baseUrl}: ${(err as Error).message}`);
      }
      await checkResponse(res, who);
      let text = "";
      let finish = "";
      const calls = new Map<number, { id: string; name: string; args: string }>();
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("event-stream") || !res.body) {
        // some servers ignore stream: true
        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> };
        const ch = j.choices?.[0];
        text = ch?.message?.content ?? "";
        if (text) onText(text);
        (ch?.message?.tool_calls ?? []).forEach((c, i) => calls.set(i, { id: c.id, name: c.function.name, args: c.function.arguments }));
        finish = ch?.finish_reason ?? "";
      } else {
        for await (const data of sseData(res.body)) {
          if (!data || data === "[DONE]") continue;
          let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; error?: { message?: string } };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk.error) throw new ProviderError(`${who}: ${chunk.error.message ?? "stream error"}`);
          const ch = chunk.choices?.[0];
          if (!ch) continue;
          const delta = ch.delta;
          if (delta?.content) {
            text += delta.content;
            onText(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const idx = tc.index ?? calls.size;
            const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(idx, cur);
          }
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, c]) => {
          const call: ToolCall = { id: c.id || `call_${i}_${Date.now().toString(36)}`, name: c.name, input: {} };
          if (c.args.trim()) {
            try {
              const parsed = JSON.parse(c.args);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) call.input = parsed as Record<string, unknown>;
              else call.parseError = "The arguments must be a JSON object.";
            } catch {
              call.parseError = "The arguments were not valid JSON.";
            }
          }
          return call;
        });
      const stopReason = toolCalls.length && finish !== "length" ? "tool_use" : (FINISH[finish] ?? (finish || "end_turn"));
      return { text, toolCalls, stopReason };
    },
  };
}

export function chatAdapter(p: StoredProvider, opts: AdapterOptions = {}): ChatAdapter {
  if (p.kind === "anthropic") return anthropicAdapter(p, opts);
  if (p.kind === "openai" || p.kind === "openai-compatible") {
    if (p.kind === "openai" && !p.apiKey) throw new ProviderError(`${p.label} has no API key. Add one in Settings, AI providers.`);
    return openAiAdapter(p, opts);
  }
  throw new ProviderError(`${p.label} cannot run the agent. Pick an Anthropic or OpenAI-compatible provider.`);
}
