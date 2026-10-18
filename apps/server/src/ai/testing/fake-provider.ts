// A fake AI provider for tests and live checks: speaks the Anthropic Messages API (SSE), OpenAI chat
// completions (SSE) and OpenAI Images. The chat side plays a small scripted agent that calls real
// OpenCrease tools (get_basic_info, create_artboard, write_html, get_screenshot, finish_working_on_nodes).
// Run standalone: `npx tsx apps/server/src/ai/testing/fake-provider.ts 29917`
import { createServer, type IncomingMessage, type Server } from "node:http";
import { deflateSync } from "node:zlib";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A real PNG: a two-colour diagonal gradient seeded by the prompt, so different prompts look different. */
export function fakePng(width: number, height: number, seedText: string): Buffer {
  const w = Math.max(1, Math.min(2048, Math.round(width)));
  const h = Math.max(1, Math.min(2048, Math.round(height)));
  const s = hashString(seedText);
  const a = [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const b = [255 - a[0]! * 0.6, 180 + (a[1]! % 60), 120 + (a[2]! % 100)];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(a[c]! * (1 - t) + b[c]! * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------- script

export interface ScriptedReply {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

export interface ScriptContext {
  fileId: string;
  /** tool results so far in this user turn, oldest first (text only) */
  results: Array<{ name: string; text: string; isError: boolean }>;
  /** the latest user text */
  userText: string;
  hasTools: boolean;
}

export const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" fill="#D97757"/><path d="M36 64l16 16 32-40" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The created artboard's id from a create_artboard result (skips the file header block). */
function artboardId(text: string): string {
  const ids = [...text.matchAll(/"id":\s*"([^"]+)",\s*"name"/g)].map((m) => m[1]!);
  return ids[ids.length - 1] ?? "";
}

/** The default script: a short design session that exercises the real tools. */
export function defaultScript(ctx: ScriptContext): ScriptedReply {
  if (!ctx.hasTools) return { text: `Here is the graphic.\n${FAKE_SVG}`, toolCalls: [] };
  const done = (n: string) => ctx.results.filter((r) => r.name === n && !r.isError);
  const last = ctx.results[ctx.results.length - 1];
  if (/^say /i.test(ctx.userText)) return { text: ctx.userText.slice(4), toolCalls: [] };
  if (!ctx.results.length) {
    return { text: "Brief: mood is mineral, bone ground with an oxidized copper accent, Geist for display and body. Looking at the file first.", toolCalls: [{ name: "get_basic_info", input: { fileId: ctx.fileId } }] };
  }
  if (!done("create_artboard").length) {
    return { text: "", toolCalls: [{ name: "create_artboard", input: { fileId: ctx.fileId, name: "Agent card", styles: { width: "480px", height: "320px", backgroundColor: "#F3EFE7", padding: "40px", gap: "12px" } } }] };
  }
  if (!done("write_html").length) {
    const board = artboardId(done("create_artboard")[0]!.text);
    return {
      text: "Writing the heading block.",
      toolCalls: [
        {
          name: "write_html",
          input: {
            fileId: ctx.fileId,
            targetNodeId: board,
            mode: "insert-children",
            html: '<div layer-name="Heading" style="display:flex;flex-direction:column;gap:8px"><div style="font-family:Geist;font-size:40px;font-weight:700;color:#1F2A2E;letter-spacing:-0.02em">Fired slow.</div><div style="font-family:Geist;font-size:15px;color:#4A5357">Stoneware thrown by hand in small batches.</div></div>',
          },
        },
      ],
    };
  }
  if (!done("get_screenshot").length) {
    const board = artboardId(done("create_artboard")[0]!.text);
    return { text: "", toolCalls: [{ name: "get_screenshot", input: { fileId: ctx.fileId, nodeId: board } }] };
  }
  if (!done("finish_working_on_nodes").length) return { text: "", toolCalls: [{ name: "finish_working_on_nodes", input: { fileId: ctx.fileId } }] };
  return { text: `Done. I added the "Agent card" artboard with a heading block and checked it in a screenshot: spacing and contrast read well, nothing clips.${last?.isError ? " One tool call failed along the way." : ""}`, toolCalls: [] };
}

// ---------------------------------------------------------------------------------------------- wire formats

type Json = Record<string, unknown>;

function sse(events: Array<{ event?: string; data: unknown }>): string {
  return events.map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`).join("");
}

function splitText(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 12) out.push(text.slice(i, i + 12));
  return out;
}

let idCounter = 0;
const nextId = (p: string) => `${p}_${(++idCounter).toString(36)}${Date.now().toString(36)}`;

export function anthropicSse(reply: ScriptedReply, model: string): string {
  const events: Array<{ event: string; data: unknown }> = [];
  events.push({ event: "message_start", data: { type: "message_start", message: { id: nextId("msg"), type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } } });
  let index = 0;
  if (reply.text) {
    events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "text", text: "" } } });
    for (const piece of splitText(reply.text)) events.push({ event: "content_block_delta", data: { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } } });
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index } });
    index++;
  }
  for (const call of reply.toolCalls) {
    events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "tool_use", id: nextId("toolu"), name: call.name, input: {} } } });
    const json = JSON.stringify(call.input);
    for (let i = 0; i < json.length; i += 40) events.push({ event: "content_block_delta", data: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 40) } } });
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index } });
    index++;
  }
  events.push({ event: "message_delta", data: { type: "message_delta", delta: { stop_reason: reply.toolCalls.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } } });
  events.push({ event: "message_stop", data: { type: "message_stop" } });
  return sse(events);
}

export function openAiSse(reply: ScriptedReply, model: string): string {
  const id = nextId("chatcmpl");
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const events: Array<{ data: unknown }> = [{ data: { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] } }];
  for (const piece of splitText(reply.text)) events.push({ data: { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] } });
  reply.toolCalls.forEach((call, i) => {
    const json = JSON.stringify(call.input);
    events.push({ data: { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: nextId("call"), type: "function", function: { name: call.name, arguments: "" } }] }, finish_reason: null }] } });
    for (let k = 0; k < json.length; k += 40) events.push({ data: { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: json.slice(k, k + 40) } }] }, finish_reason: null }] } });
  });
  events.push({ data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: reply.toolCalls.length ? "tool_calls" : "stop" }] } });
  events.push({ data: "[DONE]" });
  return sse(events);
}

// ---------------------------------------------------------------------------------------------- request parsing

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && (c as Json).type === "text" ? String((c as Json).text) : "")).join("\n");
  return "";
}

/** The current user turn of an Anthropic request: latest user text and the tool results after it. */
export function anthropicContext(body: Json): ScriptContext {
  const messages = (body.messages as Json[]) ?? [];
  const toolNames = new Map<string, string>();
  let userText = "";
  let results: ScriptContext["results"] = [];
  for (const m of messages) {
    const content = Array.isArray(m.content) ? (m.content as Json[]) : [{ type: "text", text: m.content }];
    if (m.role === "assistant") for (const b of content) if (b.type === "tool_use") toolNames.set(String(b.id), String(b.name));
    if (m.role !== "user") continue;
    const tr = content.filter((b) => b.type === "tool_result");
    if (tr.length) for (const b of tr) results.push({ name: toolNames.get(String(b.tool_use_id)) ?? "", text: textOf(b.content), isError: b.is_error === true });
    else {
      userText = textOf(content).replace(/^(\[[^\]]*\]\n?)+/, "").trim();
      results = [];
    }
  }
  const fileId = /fileId \\?"([^"\\]+)/.exec(JSON.stringify(body.system ?? ""))?.[1] ?? "";
  return { fileId, results, userText, hasTools: Array.isArray(body.tools) && body.tools.length > 0 };
}

export function openAiContext(body: Json): ScriptContext {
  const messages = (body.messages as Json[]) ?? [];
  const toolNames = new Map<string, string>();
  let userText = "";
  let results: ScriptContext["results"] = [];
  let system = "";
  for (const m of messages) {
    if (m.role === "system") system = textOf(m.content);
    if (m.role === "assistant") for (const c of (m.tool_calls as Json[]) ?? []) toolNames.set(String(c.id), String((c.function as Json).name));
    if (m.role === "tool") {
      const text = textOf(m.content);
      results.push({ name: toolNames.get(String(m.tool_call_id)) ?? "", text, isError: text.startsWith("Error: ") });
    }
    if (m.role === "user") {
      const text = textOf(m.content);
      if (text.startsWith("Images returned by the tool calls above")) continue;
      userText = text.replace(/^(\[[^\]]*\]\n?)+/, "").trim();
      results = [];
    }
  }
  const fileId = /fileId "([^"]+)"/.exec(system)?.[1] ?? "";
  return { fileId, results, userText, hasTools: Array.isArray(body.tools) && body.tools.length > 0 };
}

// ---------------------------------------------------------------------------------------------- server

export interface FakeProviderOptions {
  port?: number;
  script?: (ctx: ScriptContext) => ScriptedReply;
  /** delay between SSE chunks, to see streaming in the UI */
  chunkDelayMs?: number;
  /** delay before an image is returned */
  imageDelayMs?: number;
}

export interface FakeProvider {
  url: string;
  port: number;
  requests: Array<{ method: string; path: string; headers: IncomingMessage["headers"]; body: Json }>;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const type = req.headers["content-type"] ?? "";
  if (type.includes("multipart/form-data")) {
    const text = raw.toString("latin1");
    const prompt = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] ?? "";
    const size = /name="size"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] ?? "";
    return { multipart: true, prompt, size, hasImage: /name="image"/.test(text) };
  }
  try {
    return raw.length ? (JSON.parse(raw.toString("utf8")) as Json) : {};
  } catch {
    return {};
  }
}

export async function startFakeProvider(opts: FakeProviderOptions = {}): Promise<FakeProvider> {
  const script = opts.script ?? defaultScript;
  const requests: FakeProvider["requests"] = [];
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await readBody(req);
    requests.push({ method: req.method ?? "GET", path: url.pathname, headers: req.headers, body });
    const auth = String(req.headers["x-api-key"] ?? req.headers.authorization ?? "");
    if (auth.includes("bad-key")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
      return;
    }
    const streamOut = async (text: string) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const parts = text.split("\n\n").filter(Boolean);
      for (const p of parts) {
        if (res.destroyed) return;
        res.write(`${p}\n\n`);
        if (opts.chunkDelayMs) await new Promise((r) => setTimeout(r, opts.chunkDelayMs));
      }
      res.end();
    };
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "claude-opus-5-5" }, { id: "fake-chat" }, { id: "fake-image" }] }));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/messages")) {
      await streamOut(anthropicSse(script(anthropicContext(body)), String(body.model ?? "")));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      await streamOut(openAiSse(script(openAiContext(body)), String(body.model ?? "")));
      return;
    }
    if (req.method === "POST" && (url.pathname.endsWith("/images/generations") || url.pathname.endsWith("/images/edits"))) {
      const prompt = String(body.prompt ?? "");
      if (/fail/i.test(prompt)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Your prompt was rejected by the fake safety system." } }));
        return;
      }
      const [w, h] = String(body.size ?? "512x512").split("x").map(Number);
      if (opts.imageDelayMs) await new Promise((r) => setTimeout(r, opts.imageDelayMs));
      const png = fakePng(Math.min(w || 512, 512), Math.min(h || 512, 512), prompt + (body.multipart ? "edit" : ""));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ b64_json: png.toString("base64") }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `fake provider: no route ${req.method} ${url.pathname}` } }));
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

if (/fake-provider\.(ts|js)$/.test(process.argv[1] ?? "")) {
  const port = Number(process.argv[2]) || 29917;
  void startFakeProvider({ port, chunkDelayMs: Number(process.env.FAKE_CHUNK_MS ?? 25), imageDelayMs: Number(process.env.FAKE_IMAGE_MS ?? 1500) }).then((p) => {
    console.log(`Fake AI provider at ${p.url}  (Anthropic: ${p.url}, OpenAI-compatible: ${p.url}/v1)`);
  });
}
