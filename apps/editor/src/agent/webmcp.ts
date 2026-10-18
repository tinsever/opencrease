// WebMCP (SPEC §8.1): expose the MCP tools to browser-hosted agents through navigator.modelContext,
// when the browser has it. Feature-detected; nothing happens in browsers without the API.
//
// Calls go through POST /api/tools/call like the stdio proxy, so they get the same validation,
// permission prompt, required steps and undo behaviour as any other agent. The client name is
// "webmcp" (or "webmcp:<agent>" when the browser names the agent).
import { TOOLS, toolJsonSchema, type ToolResult } from "@opencrease/protocol";

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean };
  execute(args: Record<string, unknown>, agent?: unknown): Promise<ToolResult>;
}

interface ModelContext {
  registerTool?(tool: WebMcpTool): unknown | Promise<unknown>;
  unregisterTool?(name: string): unknown;
  provideContext?(ctx: { tools: WebMcpTool[] }): void;
}

export function getModelContext(): ModelContext | null {
  if (typeof navigator === "undefined") return null;
  // Current Chrome exposes document.modelContext; older implementations use navigator.
  const mc = (typeof document !== "undefined" ? (document as Document & { modelContext?: ModelContext }).modelContext : undefined) ?? (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  return mc && (typeof mc.registerTool === "function" || typeof mc.provideContext === "function") ? mc : null;
}

function agentName(agent: unknown): string {
  const n = agent && typeof agent === "object" ? (agent as { name?: unknown }).name : undefined;
  return typeof n === "string" && n ? `webmcp:${n}` : "webmcp";
}

async function callViaServer(tool: string, args: Record<string, unknown>, agent: unknown): Promise<ToolResult> {
  const res = await fetch("/api/tools/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, args: args ?? {}, client: { name: agentName(agent) } }),
  });
  if (!res.ok) return { content: [{ type: "text", text: `OpenCrease server error (HTTP ${res.status}).` }], isError: true };
  return (await res.json()) as ToolResult;
}

export function webMcpTools(): WebMcpTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toolJsonSchema(t),
    annotations: { readOnlyHint: t.readOnly, untrustedContentHint: true, consequentialHint: t.destructive === true },
    execute: (args, agent) => callViaServer(t.name, args, agent),
  }));
}

let registered = false;

/** Register every tool with navigator.modelContext. Returns false when the API is missing. */
export async function startWebMcp(): Promise<boolean> {
  const mc = getModelContext();
  if (!mc || registered) return registered;
  registered = true;
  const tools = webMcpTools();
  try {
    if (typeof mc.registerTool === "function") for (const tool of tools) await mc.registerTool(tool);
    else mc.provideContext?.({ tools });
  } catch (err) {
    console.warn("[opencrease] WebMCP registration failed", err);
    for (const tool of tools) { try { mc.unregisterTool?.(tool.name); } catch { /* registration may have failed before this tool */ } }
    registered = false;
  }
  return registered;
}
