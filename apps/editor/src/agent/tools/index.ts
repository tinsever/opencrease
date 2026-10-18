// Registry of editor-side tools and the pure part of running one: header, body, errors, review nudges.
import { artboardOf, getNode, isModelError, type NodeId } from "@opencrease/model";
import { errorResult, getTool, withFileHeader, type ContentBlock, type RequiredStep, type ToolResult } from "@opencrease/protocol";
import { RawBlock, ToolError, type EditorTool, type ToolBody, type ToolEnv } from "../env";
import { briefGate, LEGACY_STEPS, qualityWarnings } from "../quality";
import { reviewReminder, type ReviewTracker } from "../review";
import { componentTools } from "./components";
import { ofTools } from "./of";
import { outputTools } from "./output";
import { pageTools } from "./pages";
import { readTools } from "./read";
import { themeTools } from "./theme";
import { tokenTools } from "./tokens";
import { writeTools } from "./write";
import { vectorTools } from "./vector";

export const EDITOR_TOOLS: Record<string, EditorTool> = {
  ...readTools,
  ...writeTools,
  ...pageTools,
  ...tokenTools,
  ...outputTools,
  ...themeTools,
  ...vectorTools,
  ...componentTools,
  ...ofTools,
};

export function toolLabel(name: string, args: Record<string, unknown>, env: Pick<ToolEnv, "doc">): string {
  const tool = EDITOR_TOOLS[name];
  try {
    const label = tool?.label?.(args, env.doc);
    if (label) return label;
  } catch {
    // labels are cosmetic
  }
  return getTool(name)?.title ?? name;
}

function bodyToContent(body: ToolBody): ContentBlock[] {
  return body.map((part) => {
    if (part instanceof RawBlock) return part.block;
    return { type: "text" as const, text: typeof part === "string" ? part : JSON.stringify(part, null, 2) };
  });
}

export function errorMessage(err: unknown, tool: string): string {
  if (err instanceof ToolError) return err.message;
  if (isModelError(err)) return (err as Error).message;
  const msg = err instanceof Error ? err.message : String(err);
  return `${tool} failed: ${msg}`;
}

export interface RunContext {
  review: ReviewTracker;
  /** Node ids passed to env.touch during the call. */
  touched(): Iterable<NodeId>;
  /** Required steps in force (from the server's policy). Omitted: review nudges only. */
  steps?: readonly RequiredStep[];
}

/** Artboards containing the touched nodes (in the current document). */
export function touchedArtboards(env: Pick<ToolEnv, "doc">, ids: Iterable<NodeId>): NodeId[] {
  const out = new Set<NodeId>();
  for (const id of ids) {
    if (!getNode(env.doc, id)) continue;
    const board = artboardOf(env.doc, id);
    if (board) out.add(board.id);
  }
  return [...out];
}

/** Run a tool in an environment. Never throws; failures come back as error results. */
export async function runEditorTool(name: string, args: Record<string, unknown>, env: ToolEnv, ctx: RunContext): Promise<{ result: ToolResult; ok: boolean; error?: string; artboards: NodeId[] }> {
  const tool = EDITOR_TOOLS[name];
  if (!tool) return { result: errorResult(`Tool "${name}" is not available in the editor.`), ok: false, error: "unknown tool", artboards: [] };
  const steps = ctx.steps ?? LEGACY_STEPS;
  try {
    if (name === "write_html") {
      const gate = briefGate(env.doc, args.targetNodeId, steps);
      if (gate) return { result: errorResult(gate), ok: false, error: "brief required", artboards: [] };
    }
    const body = await tool.run(args, env);
    const artboards = touchedArtboards(env, ctx.touched());
    const content = bodyToContent(body);
    if (tool.write) for (const text of qualityWarnings(name, args, env.doc, steps)) content.push({ type: "text", text });
    if (tool.write && artboards.length && steps.includes("review")) {
      for (const id of ctx.review.recordWrite(env.fileId, artboards)) {
        content.push({ type: "text", text: reviewReminder(getNode(env.doc, id)?.name ?? id) });
      }
    }
    return { result: withFileHeader(env.doc, { content }), ok: true, artboards };
  } catch (err) {
    const message = errorMessage(err, name);
    return { result: errorResult(message), ok: false, error: message, artboards: [] };
  }
}
