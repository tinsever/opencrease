// Executes a tool call from the bridge: focuses the file, shows the needed page, builds the tool
// environment over the DocStore and the canvas, logs the call and marks agent work.
import type { AssetMeta, NodeId, Tx } from "@opencrease/model";
import { errorResult, getTool, type AgentClientInfo, type CallPolicy, type ToolResult } from "@opencrease/protocol";
import { flushSave, getOpenFile, getState, clearAgentWork, markAgentWork, noteAgentClient, openFile } from "../state/workspace";
import { pinTopLevel } from "../canvas/virtual";
import { logAgentCall } from "./activity";
import { findNodeElement, measureNode, settleLayout, showPage, waitFrames } from "./dom";
import type { SavedExport, ToolEnv } from "./env";
import { exportCombinedPdf, exportRequests, fillImageOf, screenshotNode } from "./exporter";
import { lookupFontFamilies } from "./font-lookup";
import { startPendingGeneration } from "../ai/gen-jobs";
import { ReviewTracker } from "./review";
import { versionApi } from "./versions";
import { EDITOR_TOOLS, runEditorTool, toolLabel } from "./tools";

const review = new ReviewTracker();
const headless = typeof location !== "undefined" && new URLSearchParams(location.search).has("headless");

export async function assetMeta(fileId: string, hash: string): Promise<AssetMeta | null> {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/assets/${hash}`, { method: "HEAD" });
    if (!res.ok) return null;
    const meta: AssetMeta = { hash, mime: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0], size: Number(res.headers.get("content-length") ?? 0) };
    if (meta.mime.startsWith("image/")) {
      const img = new Image();
      img.src = `/api/files/${encodeURIComponent(fileId)}/assets/${hash}`;
      await img.decode().catch(() => undefined);
      if (img.naturalWidth) {
        meta.width = img.naturalWidth;
        meta.height = img.naturalHeight;
      }
    }
    return meta;
  } catch {
    return null;
  }
}

export async function executeToolCall(tool: string, args: Record<string, unknown>, client: AgentClientInfo, policy?: CallPolicy): Promise<ToolResult> {
  const started = Date.now();
  const handler = EDITOR_TOOLS[tool];
  if (!handler) return errorResult(`Tool "${tool}" is not available in this editor version.`);
  const fileId = (typeof args.fileId === "string" && args.fileId) || getState().activeFileId;
  if (!fileId) return errorResult("No file is open in the editor. Call list_resources to find a file, then open_file.");
  noteAgentClient(client.name);

  let file;
  try {
    file = await openFile(fileId);
  } catch (err) {
    return errorResult(`Could not open file ${fileId}: ${(err as Error).message}`);
  }
  const store = file.store;
  let pageId: string | undefined;
  try {
    pageId = handler.page?.(args, store.doc);
  } catch {
    pageId = undefined;
  }
  await showPage(fileId, pageId);

  // Pin referenced subtrees before reads or writes need real DOM geometry.
  const tops = new Set<NodeId>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && store.doc.nodes[value]) {
      let node = store.doc.nodes[value];
      while (node.parentId && store.doc.nodes[node.parentId]?.type !== "Root") node = store.doc.nodes[node.parentId];
      tops.add(node.id);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(args);
  pinTopLevel(tops, 30_000);
  if (tops.size) await waitFrames();

  const title = getTool(tool)?.title ?? tool;
  const touched = new Set<NodeId>();
  let transacted = false;
  const env: ToolEnv = {
    fileId,
    get doc() {
      return store.doc;
    },
    client,
    get activePageId() {
      return getOpenFile(fileId)?.activePageId ?? file.activePageId;
    },
    get selection() {
      return getOpenFile(fileId)?.selection ?? [];
    },
    editorUrl: (path) => `${location.origin}${path}`,
    transact<T>(fn: (tx: Tx) => T): T {
      if (transacted) throw new Error(`${tool} tried to make a second undo step`);
      transacted = true;
      return store.transact(title, fn, { origin: "agent" });
    },
    touch(ids) {
      for (const id of ids) touched.add(id);
    },
    measure: (id) => measureNode(fileId, id),
    computedStyle(id) {
      const el = findNodeElement(fileId, id);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return (prop) => cs.getPropertyValue(prop);
    },
    settle: settleLayout,
    showPage: (p) => showPage(fileId, p),
    screenshot: (id, scale) => screenshotNode(fileId, id, scale === 2 ? 2 : 1),
    async exportNodes(requests) {
      const out = await exportRequests(fileId, requests, "workspace");
      return {
        files: out.files.map((f) => {
          const saved: SavedExport = { nodeId: f.nodeId, name: f.name, format: f.format, scale: f.scale, path: f.path ?? f.filename, width: f.width, height: f.height };
          if (f.durationSeconds !== undefined) Object.assign(saved, { durationSeconds: f.durationSeconds, fps: f.fps, codec: f.codec });
          return saved;
        }),
        errors: out.errors,
        warnings: out.warnings,
      };
    },
    async exportCombinedPdf(nodeIds) {
      const { file: pdf, pages, warning } = await exportCombinedPdf(fileId, nodeIds, { destination: "workspace" });
      return { path: pdf.path ?? pdf.filename, pages, warning };
    },
    fontFamilies: (names) => lookupFontFamilies(names),
    fillImage: (id) => fillImageOf(fileId, id),
    assetMeta: (hash) => assetMeta(fileId, hash),
    agentWork: () => getState().agentWork[fileId] ?? {},
    releaseWork: (ids) => {
      if (ids.length) clearAgentWork(fileId, ids);
    },
    reviewed: (artboardId) => review.recordScreenshot(fileId, artboardId),
    versions: versionApi(fileId),
  };

  const label = toolLabel(tool, args, env);
  const { result, ok, error, artboards } = await runEditorTool(tool, args, env, { review, touched: () => touched, steps: policy?.steps });
  if (ok && handler.write) {
    const genNote = startPendingGeneration(fileId, touched);
    if (genNote) result.content.push({ type: "text", text: genNote });
  }
  if (ok && handler.write && artboards.length) markAgentWork(fileId, artboards, client.name, label);
  logAgentCall({ fileId, client: client.name, tool, label, time: started, durationMs: Date.now() - started, ok, error, write: handler.write });
  if (ok && handler.write && headless) {
    await flushSave(fileId);
    if (getOpenFile(fileId)?.saveState === "error") return errorResult("The tool changed the document, but saving it to disk failed.");
  }
  return result;
}
