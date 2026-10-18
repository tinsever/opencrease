// The in-app agent: runs a user-configured chat model against the same MCP tools external agents get,
// executed through the server's tool executor. One conversation per file, kept in ~/.opencrease/chats.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CLAUDE_MODELS, inAppAgentClient, TOOLS,
  type AgentConversationView, type AgentMessageRequest, type AgentStep, type AgentStreamEvent, type AgentTurn,
  type ContentBlock, type ToolResult,
} from "@opencrease/protocol";
import type { Guides } from "../guides";
import type { CallTool } from "../tools";
import { atomicWrite, type Workspace } from "../workspace";
import type { FetchLike } from "./http-util";
import { chatAdapter, type ChatAdapter, type HistoryBlock, type HistoryMessage, type ToolCall, type ToolResultMessage, type ToolSpec } from "./llm";
import type { AiSecrets, StoredProvider } from "./secrets";

export const MAX_ROUNDS = 60;

interface Conversation {
  fileId: string;
  /** system prompt frozen at the start of the conversation, so the history stays append-only */
  system?: string;
  turns: AgentTurn[];
  history: HistoryMessage[];
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

let toolSpecCache: ToolSpec[] | null = null;

/** JSON schemas of every MCP tool, for the model. */
export function agentToolSpecs(): ToolSpec[] {
  if (toolSpecCache) return toolSpecCache;
  toolSpecCache = TOOLS.map((t) => {
    const schema = zodToJsonSchema(z.object(t.inputShape), { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.$schema;
    delete schema.definitions;
    if (schema.type !== "object") schema.type = "object";
    return { name: t.name, description: t.description, schema };
  });
  return toolSpecCache;
}

const FILE_SCOPED = new Set(TOOLS.filter((t) => "fileId" in t.inputShape).map((t) => t.name));

export function systemPrompt(file: { id: string; name: string }, guide: string): string {
  return `You are the design agent built into OpenCrease, a local design tool whose canvas is real HTML and CSS. You work on the user's file through the same tools external MCP agents use, and the user watches the canvas while you work.

The file is "${file.name}" (fileId "${file.id}"). Pass this fileId to every tool that takes one.

How you work:
- The design guide below is your standard. It merges the built-in guide with the user's taste and this file's own rules, later layers winning. Follow its required steps.
- Brief first: before the first write to a new artboard, post a short brief in chat (mood, palette, type, direction) unless the file already has tokens, then store it as tokens.
- Build in small steps, one visual group per write_html call, so the user can watch and stop you.
- Review: after each section call get_screenshot and check spacing, type hierarchy, contrast, alignment and clipping. Fix what you find before moving on.
- Start with get_basic_info. When the user says "this" or "the selection", use the selection sent with their message, or call get_selection.
- Only generate AI images (gen:// URLs) when the user asks for images; read get_guide({ topic: "image-generation" }) first.
- Keep chat replies short and plain: what you did, what you checked, what is left. Never show raw node ids to the user.
- When you are done, call finish_working_on_nodes.

<design-guide>
${guide.trim() || "(The guide is empty.)"}
</design-guide>`;
}

function userContent(req: AgentMessageRequest): HistoryBlock[] {
  const lines: string[] = [];
  if (req.selection?.length) {
    lines.push(`[The user has selected: ${req.selection.slice(0, 20).map((s) => `"${s.name}" (${s.type}, id ${s.id})`).join(", ")}]`);
  } else lines.push("[Nothing is selected]");
  if (req.pageId) lines.push(`[The user is viewing page ${req.pageId}]`);
  return [{ type: "text", text: `${lines.join("\n")}\n\n${req.text.trim()}` }];
}

function resultBlocks(result: ToolResult): HistoryBlock[] {
  return result.content.map((b: ContentBlock) => (b.type === "image" ? { type: "image", data: b.data, mimeType: b.mimeType } : { type: "text", text: b.text }));
}

/** Remember node names seen in tool results, so steps can say "Hero" instead of an id. */
function collectNames(result: ToolResult, names: Map<string, string>): void {
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.name === "string") names.set(o.id, o.name);
      Object.values(o).forEach(visit);
    }
  };
  for (const b of result.content) {
    if (b.type !== "text") continue;
    for (const m of b.text.matchAll(/"([^"\n]{1,80})" \(([^()\s]+)\)/g)) names.set(m[2]!, m[1]!);
    const t = b.text.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        visit(JSON.parse(t));
      } catch {
        // not JSON
      }
    }
  }
}

export function stepLabel(tool: string, args: Record<string, unknown>, names: Map<string, string>, result?: ToolResult): string {
  const nameOf = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "") : "");
  const firstId = (k: string) => {
    const v = args[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (tool === "write_html" && result && !result.isError) {
    for (const b of result.content) {
      if (b.type !== "text" || !b.text.includes("createdNodes")) continue;
      try {
        const nodes = (JSON.parse(b.text) as { createdNodes?: Array<{ name?: string }> }).createdNodes ?? [];
        if (nodes.length) return nodes.length === 1 ? String(nodes[0]!.name) : `${nodes[0]!.name} and ${nodes.length - 1} more`;
      } catch {
        // fall through
      }
    }
  }
  if (tool === "create_artboard" || tool === "create_page" || tool === "create_file") return String(args.name ?? "");
  if (tool === "get_guide") return String(args.topic ?? "");
  if (tool === "update_styles") {
    const ids = (Array.isArray(args.updates) ? args.updates : []).flatMap((u) => (u && typeof u === "object" && Array.isArray((u as { nodeIds?: unknown }).nodeIds) ? (u as { nodeIds: unknown[] }).nodeIds : []));
    return ids.length === 1 ? nameOf(ids[0]) : ids.length ? `${ids.length} layers` : "";
  }
  if (tool === "set_text_content" || tool === "rename_nodes") {
    const n = Array.isArray(args.updates) ? args.updates.length : 0;
    return n === 1 ? nameOf((args.updates as Array<{ nodeId?: string }>)[0]?.nodeId) : n ? `${n} layers` : "";
  }
  if (tool === "duplicate_nodes") return Array.isArray(args.nodes) ? (args.nodes.length === 1 ? nameOf((args.nodes[0] as { id?: string }).id) : `${args.nodes.length} copies`) : "";
  if (tool === "delete_nodes" || tool === "get_computed_styles") {
    const ids = Array.isArray(args.nodeIds) ? args.nodeIds : [];
    return ids.length === 1 ? nameOf(ids[0]) : ids.length ? `${ids.length} layers` : "";
  }
  return nameOf(firstId("nodeId")) || nameOf(firstId("targetNodeId"));
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

export interface AgentDeps {
  secrets: AiSecrets;
  guides: Guides;
  workspace: Workspace;
  callTool: CallTool;
  configDir: string;
  fetch?: FetchLike;
}

export class AgentRunner {
  private cache = new Map<string, Conversation>();
  private running = new Map<string, AbortController>();

  constructor(private deps: AgentDeps) {}

  private path(fileId: string): string {
    return join(this.deps.configDir, "chats", `${fileId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  }

  private async load(fileId: string): Promise<Conversation> {
    const hit = this.cache.get(fileId);
    if (hit) return hit;
    let conv: Conversation = { fileId, turns: [], history: [] };
    try {
      const raw = JSON.parse(await readFile(this.path(fileId), "utf8")) as Partial<Conversation>;
      if (Array.isArray(raw.turns) && Array.isArray(raw.history)) conv = { fileId, system: typeof raw.system === "string" ? raw.system : undefined, turns: raw.turns, history: raw.history };
    } catch {
      // no conversation yet
    }
    this.cache.set(fileId, conv);
    return conv;
  }

  private async save(conv: Conversation): Promise<void> {
    await mkdir(join(this.deps.configDir, "chats"), { recursive: true });
    await atomicWrite(this.path(conv.fileId), JSON.stringify(conv));
  }

  isRunning(fileId: string): boolean {
    return this.running.has(fileId);
  }

  async view(fileId: string): Promise<AgentConversationView> {
    const conv = await this.load(fileId);
    return { fileId, turns: conv.turns, running: this.isRunning(fileId) };
  }

  async clear(fileId: string): Promise<void> {
    if (this.isRunning(fileId)) throw new AgentError("The agent is still working. Stop it first.", 409);
    this.cache.set(fileId, { fileId, turns: [], history: [] });
    await rm(this.path(fileId), { force: true });
  }

  stop(fileId: string): boolean {
    const ctl = this.running.get(fileId);
    if (!ctl) return false;
    ctl.abort();
    return true;
  }

  /** Check everything needed before a run starts, so errors come back as plain HTTP errors. */
  async prepare(fileId: string, req: AgentMessageRequest): Promise<{ provider: StoredProvider; model: string; adapter: ChatAdapter }> {
    if (!req.text?.trim()) throw new AgentError("Write a message first.");
    if (this.isRunning(fileId)) throw new AgentError("The agent is already working on this file. Stop it or wait for it to finish.", 409);
    await this.deps.workspace.require(fileId);
    const provider = await this.deps.secrets.resolve("chat", req.providerId);
    if (!provider) {
      throw new AgentError(
        req.providerId
          ? "That provider cannot run the agent. Pick an Anthropic or OpenAI-compatible provider."
          : "No agent provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings, AI providers.",
      );
    }
    const model = req.model?.trim() || provider.chatModel || (provider.kind === "anthropic" ? CLAUDE_MODELS[0]!.id : "");
    if (!model) throw new AgentError(`Set a chat model for ${provider.label} in Settings, AI providers.`);
    let adapter: ChatAdapter;
    try {
      adapter = chatAdapter(provider, { fetch: this.deps.fetch });
    } catch (err) {
      throw new AgentError((err as Error).message);
    }
    return { provider, model, adapter };
  }

  async run(
    fileId: string,
    req: AgentMessageRequest,
    prepared: { provider: StoredProvider; model: string; adapter: ChatAdapter },
    emit: (ev: AgentStreamEvent) => void,
  ): Promise<void> {
    const { provider, model, adapter } = prepared;
    const ctl = new AbortController();
    if (this.isRunning(fileId)) {
      emit({ type: "error", message: "The agent is already working on this file. Stop it or wait for it to finish." });
      return;
    }
    this.running.set(fileId, ctl);
    try {
      const conv = await this.load(fileId);
      const entry = await this.deps.workspace.require(fileId);
      if (!conv.system) conv.system = systemPrompt({ id: fileId, name: entry.name }, (await this.deps.guides.craft(fileId)).merged);
      const client = { name: inAppAgentClient(provider.kind) };
      const names = new Map<string, string>();

      const userTurn: AgentTurn = { id: newId(), role: "user", time: Date.now(), text: req.text.trim(), ...(req.selection?.length ? { selection: req.selection } : {}) };
      const turn: AgentTurn = { id: newId(), role: "assistant", time: Date.now(), parts: [], model, providerKind: provider.kind, client: client.name };
      conv.turns.push(userTurn, turn);
      conv.history.push({ role: "user", content: userContent(req) });
      emit({ type: "turn", turn: userTurn });
      emit({ type: "turn", turn });

      const parts = turn.parts!;
      const appendText = (delta: string) => {
        const last = parts[parts.length - 1];
        if (last?.type === "text") last.text += delta;
        else parts.push({ type: "text", text: delta });
        emit({ type: "text", delta });
      };
      const stepsPart = (): AgentStep[] => {
        const last = parts[parts.length - 1];
        if (last?.type === "steps") return last.steps;
        const p = { type: "steps" as const, steps: [] as AgentStep[] };
        parts.push(p);
        return p.steps;
      };

      let stopReason = "end_turn";
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const result = await adapter.stream(
            { model, system: conv.system, messages: conv.history, tools: agentToolSpecs(), signal: ctl.signal },
            appendText,
          );
          stopReason = result.stopReason;
          conv.history.push({ role: "assistant", text: result.text, toolCalls: result.toolCalls, ...(result.anthropic ? { anthropic: result.anthropic } : {}) });
          if (result.stopReason === "refusal") {
            turn.error = "The model declined this request.";
            break;
          }
          if (!result.toolCalls.length) {
            if (result.stopReason === "max_tokens") turn.error = "The reply hit the length limit and was cut off.";
            break;
          }
          const results: ToolResultMessage[] = [];
          const truncated = result.stopReason === "max_tokens";
          for (const call of result.toolCalls) results.push(await this.runTool(fileId, call, client, names, stepsPart, emit, ctl.signal, truncated));
          conv.history.push({ role: "tool", results });
          await this.save(conv);
          if (truncated) {
            turn.error = "A tool call was cut off at the length limit, so it was not run.";
            break;
          }
          if (ctl.signal.aborted) break;
          if (round === MAX_ROUNDS - 1) turn.error = `Stopped after ${MAX_ROUNDS} rounds of tool calls. Send another message to continue.`;
        }
        if (ctl.signal.aborted) turn.stopped = true;
        await this.save(conv);
        emit({ type: "done", stopReason: ctl.signal.aborted ? "stopped" : stopReason, turn });
      } catch (err) {
        if (ctl.signal.aborted) {
          turn.stopped = true;
          await this.save(conv).catch(() => {});
          emit({ type: "done", stopReason: "stopped", turn });
        } else {
          turn.error = (err as Error).message || String(err);
          await this.save(conv).catch(() => {});
          emit({ type: "error", message: turn.error, turn });
        }
      } finally {
        // any step still marked running did not finish
        for (const p of parts) if (p.type === "steps") for (const s of p.steps) if (s.status === "running") s.status = "error";
      }
    } catch (err) {
      emit({ type: "error", message: (err as Error).message || String(err) });
    } finally {
      this.running.delete(fileId);
    }
  }

  private async runTool(
    fileId: string,
    call: ToolCall,
    client: { name: string },
    names: Map<string, string>,
    stepsPart: () => AgentStep[],
    emit: (ev: AgentStreamEvent) => void,
    signal: AbortSignal,
    truncated: boolean,
  ): Promise<ToolResultMessage> {
    const args = { ...call.input };
    if (FILE_SCOPED.has(call.name) && (typeof args.fileId !== "string" || !args.fileId)) args.fileId = fileId;
    const step: AgentStep = { id: call.id, tool: call.name, label: stepLabel(call.name, args, names), status: "running" };
    stepsPart().push(step);
    emit({ type: "step", step: { ...step } });
    const fail = (message: string): ToolResultMessage => {
      step.status = "error";
      step.error = message;
      emit({ type: "step", step: { ...step } });
      return { id: call.id, name: call.name, content: [{ type: "text", text: message }], isError: true };
    };
    if (signal.aborted) return fail("Not run: the user stopped the agent.");
    if (truncated) return fail("Not run: the tool input was cut off at the length limit.");
    if (call.parseError) return fail(`${call.parseError} Call ${call.name} again with valid JSON arguments.`);
    let result: ToolResult;
    try {
      result = await this.deps.callTool(call.name, args, client);
    } catch (err) {
      return fail((err as Error).message);
    }
    collectNames(result, names);
    step.label = stepLabel(call.name, args, names, result) || step.label;
    step.status = result.isError ? "error" : "ok";
    if (result.isError) step.error = result.content.find((b) => b.type === "text")?.text?.slice(0, 300);
    if (result.content.some((b) => b.type === "image")) step.image = true;
    emit({ type: "step", step: { ...step } });
    return { id: call.id, name: call.name, content: resultBlocks(result), isError: !!result.isError };
  }
}
