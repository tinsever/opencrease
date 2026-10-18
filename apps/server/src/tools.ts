// Shared tool executor used by both MCP transports and POST /api/tools/call.
// Server-side tools run here; editor-side tools are forwarded over the bridge.
import {
  argumentError,
  normalizeToolInput,
  errorResult,
  getTool,
  normalizeArgs,
  textResult,
  toolInputSchema,
  type AgentClientInfo,
  type ToolResult,
} from "@opencrease/protocol";
import type { ZodError } from "zod";
import { deniedMessage, pendingMessage, type AgentApprovals } from "./agents";
import type { BridgeHub } from "./bridge";
import type { Guides } from "./guides";
import type { Workspace } from "./workspace";

export type CallTool = (name: string, args: unknown, client?: AgentClientInfo) => Promise<ToolResult>;

export interface ToolExecutorDeps {
  workspace: Workspace;
  bridge: BridgeHub;
  guides: Guides;
  /** Absolute editor URL for a path like "/file/<id>". */
  editorUrl(path: string): string;
  /** Ask the user before an agent client's first call (omit to allow every client). */
  approvals?: AgentApprovals;
}

const UNKNOWN_CLIENT: AgentClientInfo = { name: "unknown" };

export function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(arguments)"}: ${i.message}`)
    .join("\n");
}

/** Accepts a bare id, "/file/<id>[/<pageId>]" or a full editor URL. */
export function parseFileRef(ref: string): { fileId: string; pageId?: string } {
  const s = ref.trim();
  const m = /\/file\/([^/?#\s]+)(?:\/([^/?#\s]+))?/.exec(s);
  if (m) {
    const out: { fileId: string; pageId?: string } = { fileId: decodeURIComponent(m[1]!) };
    if (m[2]) out.pageId = decodeURIComponent(m[2]);
    return out;
  }
  return { fileId: s };
}

const LOCAL_ASSET_RE = /(?:paper-)?asset:\/\/(\/[^\s"'()<>]+|[A-Za-z]:[\\/][^\s"'()<>]+)/g;

function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The browser cannot read local files, so `asset:///absolute/path.png` (and `paper-asset://`)
 * references in agent input are copied into the file's assets here and rewritten to `asset://<sha256>`.
 */
async function rewriteLocalAssets(workspace: Workspace, fileId: string, value: unknown, cache: Map<string, string>): Promise<unknown> {
  if (typeof value === "string") {
    const matches = [...value.matchAll(LOCAL_ASSET_RE)];
    if (!matches.length) return value;
    for (const m of matches) {
      const path = decodePath(m[1]!);
      if (cache.has(path)) continue;
      try {
        const meta = await workspace.importLocalAsset(fileId, path);
        cache.set(path, `asset://${meta.hash}`);
      } catch (err) {
        throw new Error(`Could not use local image ${path}: ${(err as Error).message}`);
      }
    }
    return value.replace(LOCAL_ASSET_RE, (_all, raw: string) => cache.get(decodePath(raw)) ?? _all);
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => rewriteLocalAssets(workspace, fileId, v, cache)));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await rewriteLocalAssets(workspace, fileId, v, cache);
    return out;
  }
  return value;
}

const ASSET_TOOLS = new Set(["write_html", "update_styles", "create_artboard"]);

export function createToolExecutor(deps: ToolExecutorDeps): CallTool {
  const { workspace, bridge, guides } = deps;

  const server: Record<string, (args: Record<string, unknown>, client: AgentClientInfo) => Promise<ToolResult>> = {
    async list_resources(args) {
      const limit = typeof args.limit === "number" ? args.limit : 50;
      const files = await workspace.list();
      const open = new Set(bridge.openFiles().map((f) => f.id));
      const activeId = bridge.activeFileId;
      const rank = (id: string) => (id === activeId ? 0 : open.has(id) ? 1 : 2);
      files.sort((a, b) => rank(a.id) - rank(b.id) || b.updatedAt - a.updatedAt);
      const resources = files.slice(0, limit).map((f) => ({
        id: f.id,
        name: f.name,
        type: "file" as const,
        folder: f.folder,
        updatedAt: new Date(f.updatedAt).toISOString(),
        open: open.has(f.id),
        active: f.id === activeId,
      }));
      const out: Record<string, unknown> = { workspace: workspace.root, resources };
      if (files.length > limit) out.truncated = true;
      return textResult(out);
    },

    async create_file(args) {
      const opts: { name?: string; cloneFileId?: string } = {};
      if (typeof args.name === "string") opts.name = args.name;
      if (typeof args.cloneFileId === "string" && args.cloneFileId) opts.cloneFileId = args.cloneFileId;
      const entry = await workspace.create(opts);
      return textResult({
        fileId: entry.id,
        name: entry.name,
        url: deps.editorUrl(`/file/${entry.id}`),
        next: "Call open_file with this fileId to start working in it.",
      });
    },

    async rename_resource(args) {
      const id = (typeof args.id === "string" && args.id) || (typeof args.resourceId === "string" && args.resourceId) || "";
      if (!id) return errorResult(argumentError("rename_resource", "Pass the id of the file to rename."));
      const entry = await workspace.rename(id, String(args.name ?? ""));
      bridge.notifyFileChanged(id);
      return textResult({ id: entry.id, name: entry.name, type: "file" });
    },

    async open_file(args, client) {
      const ref = parseFileRef(String(args.fileId ?? ""));
      const pageId = (typeof args.pageId === "string" && args.pageId) || ref.pageId;
      await workspace.require(ref.fileId);
      await bridge.requestOpenFile(ref.fileId, pageId);
      const infoArgs: Record<string, unknown> = { fileId: ref.fileId };
      if (pageId) infoArgs.pageId = pageId;
      return bridge.callEditor("get_basic_info", infoArgs, client, { timeoutMs: getTool("get_basic_info")?.timeoutMs });
    },

    async get_guide(args) {
      const topic = String(args.topic ?? "");
      const text = await guides.topic(topic, bridge.activeFileId);
      if (text === null) {
        const topics = await guides.topics();
        return errorResult(argumentError("get_guide", `Unknown guide topic "${topic}". Available topics: ${topics.map((t) => `"${t}"`).join(", ")}.`));
      }
      return textResult(text || "The guide is empty.");
    },
  };

  return async function callTool(name, rawArgs, client = UNKNOWN_CLIENT) {
    const tool = getTool(name);
    if (!tool) return errorResult(`Unknown tool "${name}".`);
    let input: unknown;
    try { input = normalizeToolInput(tool, rawArgs ?? {}, bridge.activeFileId); }
    catch (err) { return errorResult(argumentError(name, (err as Error).message)); }
    const parsed = toolInputSchema(tool).safeParse(input);
    if (!parsed.success) return errorResult(argumentError(name, formatZodError(parsed.error)));
    const args = parsed.data as Record<string, unknown>;
    try {
      if (deps.approvals) {
        const decision = await deps.approvals.check(client, (c) => bridge.requestPermission(c));
        if (decision === "deny") return errorResult(deniedMessage(client.name));
        if (decision === "pending") return errorResult(pendingMessage(client.name));
      }
      if (tool.side === "server") {
        const handler = server[tool.name];
        if (!handler) return errorResult(`Tool "${name}" is not implemented on the server.`);
        return await handler(args, client);
      }
      let forwarded = normalizeArgs(tool.name, args);
      const fileId = typeof forwarded.fileId === "string" ? forwarded.fileId : undefined;
      if (fileId) {
        const entry = await workspace.find(fileId);
        if (!entry) return errorResult(`No file with id "${fileId}". Call list_resources to see the files in the workspace.`);
        if (ASSET_TOOLS.has(tool.name)) {
          forwarded = (await rewriteLocalAssets(workspace, fileId, forwarded, new Map())) as Record<string, unknown>;
        }
      }
      const policy = { steps: await guides.requiredSteps(fileId ?? bridge.activeFileId) };
      return await bridge.callEditor(tool.name, forwarded, client, { timeoutMs: tool.timeoutMs, policy });
    } catch (err) {
      return errorResult((err as Error).message || String(err));
    }
  };
}
