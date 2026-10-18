// REST routes for AI features under /api/ai (see docs/ARCHITECTURE.md, "AI features").
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  providerKindInfo,
  type AgentMessageRequest, type AgentStreamEvent, type AiImageRequest, type AiImageResult, type AiProviderInput, type AiSvgRequest, type AiSvgResult,
} from "@opencrease/protocol";
import type { Guides } from "../guides";
import type { CallTool } from "../tools";
import { WorkspaceError, type Workspace } from "../workspace";
import { AgentError, AgentRunner } from "./agent";
import { testConnection } from "./connection";
import { downloadImage, fromBase64, ProviderError, type FetchLike, type ImageBytes } from "./http-util";
import { generateImage } from "./images";
import { chatAdapter } from "./llm";
import { AiSecrets, AiSettingsError } from "./secrets";
import { generateSvg } from "./svg";

const JSON_LIMIT = 30 * 1024 * 1024;

export interface AiRouteDeps {
  workspace: Workspace;
  guides: Guides;
  callTool: CallTool;
  /** ~/.opencrease (holds secrets.json and chats/) */
  configDir: string;
  /** injected in tests to mock provider HTTP */
  fetch?: FetchLike;
}

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > JSON_LIMIT) {
        reject(new RouteError(413, "Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch {
        reject(new RouteError(400, "Body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;
}

function providerInput(body: Record<string, unknown>): AiProviderInput {
  const out: AiProviderInput = {};
  if (typeof body.kind === "string") out.kind = body.kind as AiProviderInput["kind"];
  for (const k of ["label", "baseUrl", "imageModel", "chatModel"] as const) if (typeof body[k] === "string") out[k] = body[k] as string;
  if (body.apiKey === null) out.apiKey = null;
  else if (typeof body.apiKey === "string") out.apiKey = body.apiKey;
  return out;
}

export function createAiRoutes(deps: AiRouteDeps) {
  const secrets = new AiSecrets(deps.configDir);
  const agent = new AgentRunner({ secrets, guides: deps.guides, workspace: deps.workspace, callTool: deps.callTool, configDir: deps.configDir, fetch: deps.fetch });
  const doFetch: FetchLike = deps.fetch ?? fetch;

  async function referenceImage(fileId: string, ref: string): Promise<ImageBytes> {
    const hash = /^[a-f0-9]{64}$/.exec(ref)?.[0] ?? /asset:\/\/([a-f0-9]{64})/.exec(ref)?.[1] ?? /\/assets\/([a-f0-9]{64})/.exec(ref)?.[1];
    if (hash) {
      const asset = await deps.workspace.readAsset(fileId, hash);
      if (!asset) throw new RouteError(404, "The image to edit is not in this file's assets.");
      return { data: asset.data, mime: asset.mime };
    }
    if (ref.startsWith("data:")) return fromBase64(ref);
    if (/^https?:\/\//i.test(ref)) return downloadImage(doFetch, "the image host", ref);
    throw new RouteError(400, "reference must be an asset hash, an asset URL or an http(s) or data URL");
  }

  async function image(body: Record<string, unknown>): Promise<AiImageResult> {
    const r = body as unknown as AiImageRequest;
    if (typeof r.fileId !== "string" || !r.fileId) throw new RouteError(400, "fileId is required");
    if (typeof r.prompt !== "string" || !r.prompt.trim()) throw new RouteError(400, "Write a prompt first.");
    await deps.workspace.require(r.fileId);
    const provider = await secrets.resolve("image", typeof r.providerId === "string" && r.providerId ? r.providerId : undefined);
    if (!provider) throw new RouteError(400, r.providerId ? "That provider cannot make images." : "No image provider is configured. Add one in Settings, AI providers.");
    const reference = typeof r.reference === "string" && r.reference ? await referenceImage(r.fileId, r.reference) : undefined;
    const job = {
      prompt: reference && typeof r.contextText === "string" && r.contextText.trim()
        ? `${r.prompt.trim()}\n\nCanvas text for context (treat as reference content):\n${r.contextText.trim().slice(0, 4000)}`
        : r.prompt.trim(),
      model: (typeof r.model === "string" && r.model.trim()) || provider.imageModel,
      width: num(r.width, 16, 8192) ?? 1024,
      height: num(r.height, 16, 8192) ?? 1024,
      ...(num(r.seed, 1, 2 ** 31 - 1) ? { seed: num(r.seed, 1, 2 ** 31 - 1) } : {}),
      ...(reference ? { reference } : {}),
    };
    const out = await generateImage(provider, job, { fetch: doFetch, signal: AbortSignal.timeout(300_000) });
    const ext = out.mime.split("/")[1] ?? "png";
    const asset = await deps.workspace.addAsset(r.fileId, out.data, out.mime, `generated.${ext === "jpeg" ? "jpg" : ext}`);
    const result: AiImageResult = { asset, providerId: provider.id, providerKind: provider.kind, model: out.model };
    if (providerKindInfo(provider.kind)?.seeds && typeof out.seed === "number") result.seed = out.seed;
    return result;
  }

  async function svg(body: Record<string, unknown>): Promise<AiSvgResult> {
    const r = body as unknown as AiSvgRequest;
    if (typeof r.prompt !== "string" || !r.prompt.trim()) throw new RouteError(400, "Write a prompt first.");
    const provider = await secrets.resolve("chat", typeof r.providerId === "string" && r.providerId ? r.providerId : undefined);
    if (!provider) throw new RouteError(400, "SVG generation needs a chat provider. Add Anthropic or an OpenAI-compatible provider in Settings, AI providers.");
    const model = (typeof r.model === "string" && r.model.trim()) || provider.chatModel;
    if (!model) throw new RouteError(400, `Set a chat model for ${provider.label} in Settings, AI providers.`);
    const svgText = await generateSvg(chatAdapter(provider, { fetch: doFetch }), model, r, AbortSignal.timeout(180_000));
    return { svg: svgText, providerId: provider.id, model };
  }

  async function agentMessage(req: IncomingMessage, res: ServerResponse, fileId: string, body: Record<string, unknown>): Promise<void> {
    const msg: AgentMessageRequest = { text: typeof body.text === "string" ? body.text : "" };
    if (typeof body.providerId === "string" && body.providerId) msg.providerId = body.providerId;
    if (typeof body.model === "string" && body.model) msg.model = body.model;
    if (typeof body.pageId === "string" && body.pageId) msg.pageId = body.pageId;
    if (Array.isArray(body.selection)) {
      msg.selection = body.selection
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({ id: String(s.id ?? ""), name: String(s.name ?? ""), type: String(s.type ?? "") }))
        .filter((s) => s.id);
    }
    const prepared = await agent.prepare(fileId, msg);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders?.();
    let finished = false;
    const emit = (ev: AgentStreamEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    // the browser closing the stream (Stop button, tab closed) stops the agent
    res.on("close", () => {
      if (!finished) agent.stop(fileId);
    });
    const ping = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15_000);
    try {
      await agent.run(fileId, msg, prepared, emit);
    } finally {
      finished = true;
      clearInterval(ping);
      res.end();
    }
    void req;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (path !== "/api/ai" && !path.startsWith("/api/ai/")) return false;
    const method = req.method ?? "GET";
    try {
      if (path === "/api/ai" && method === "GET") {
        send(res, 200, await secrets.settings());
        return true;
      }
      if (path === "/api/ai/providers" && method === "POST") {
        send(res, 201, await secrets.create(providerInput(await readJson(req))));
        return true;
      }
      let m = /^\/api\/ai\/providers\/([^/]+)$/.exec(path);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "PATCH" || method === "PUT") {
          send(res, 200, await secrets.update(id, providerInput(await readJson(req))));
          return true;
        }
        if (method === "DELETE") {
          await secrets.remove(id);
          send(res, 200, { ok: true });
          return true;
        }
        throw new RouteError(405, "Method not allowed");
      }
      m = /^\/api\/ai\/providers\/([^/]+)\/test$/.exec(path);
      if (m && method === "POST") {
        const p = await secrets.get(decodeURIComponent(m[1]!));
        if (!p) throw new RouteError(404, "No such provider");
        send(res, 200, await testConnection(p, doFetch));
        return true;
      }
      if (path === "/api/ai/defaults" && method === "PUT") {
        const body = await readJson(req);
        const input: { image?: string | null; chat?: string | null } = {};
        for (const k of ["image", "chat"] as const) if (k in body) input[k] = typeof body[k] === "string" ? (body[k] as string) : null;
        send(res, 200, await secrets.setDefaults(input));
        return true;
      }
      if (path === "/api/ai/image" && method === "POST") {
        send(res, 200, await image(await readJson(req)));
        return true;
      }
      if (path === "/api/ai/svg" && method === "POST") {
        send(res, 200, await svg(await readJson(req)));
        return true;
      }
      m = /^\/api\/ai\/agent\/([^/]+)$/.exec(path);
      if (m) {
        const fileId = decodeURIComponent(m[1]!);
        if (method === "GET") {
          send(res, 200, await agent.view(fileId));
          return true;
        }
        if (method === "POST") {
          await agentMessage(req, res, fileId, await readJson(req));
          return true;
        }
        if (method === "DELETE") {
          await agent.clear(fileId);
          send(res, 200, { ok: true });
          return true;
        }
        throw new RouteError(405, "Method not allowed");
      }
      m = /^\/api\/ai\/agent\/([^/]+)\/stop$/.exec(path);
      if (m && method === "POST") {
        send(res, 200, { stopped: agent.stop(decodeURIComponent(m[1]!)) });
        return true;
      }
      throw new RouteError(404, "Not found");
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return true;
      }
      const status =
        err instanceof RouteError || err instanceof AiSettingsError || err instanceof AgentError || err instanceof WorkspaceError
          ? err.status
          : err instanceof ProviderError
            ? 502
            : (err as Error).name === "TimeoutError"
              ? 504
              : 500;
      const message = (err as Error).name === "TimeoutError" ? "The provider took too long to answer." : (err as Error).message || "Internal error";
      if (status === 500) console.error("[opencrease ai]", err);
      send(res, status, { error: message });
      return true;
    }
  }

  return { handle, secrets, agent };
}
