// Export tools and finish_working_on_nodes.
import { artboardOf, descendants, getNode, getPage, type ExportSetting, type NodeId } from "@opencrease/model";
import { ToolError, type EditorTool } from "../env";
import { DEFAULT_EXPORT, DEFAULT_VIDEO, VIDEO_FORMATS } from "../export-settings";
import { asArray, pageOfIds, requireNode, requirePage } from "./common";

const exportTool: EditorTool = {
  write: false,
  page: (args, doc) => {
    if (args.nodes && typeof args.nodes === "object") return pageOfIds(doc, Object.keys(args.nodes as object));
    return typeof args.pageId === "string" && getPage(doc, args.pageId) ? args.pageId : undefined;
  },
  label: (args) => (args.type === "video" ? "Recording video" : "Exporting"),
  async run(args, env) {
    const doc = env.doc;
    const video = args.type === "video";
    const fallback = video ? DEFAULT_VIDEO : DEFAULT_EXPORT;
    const requests: Array<{ nodeId: NodeId; settings: ExportSetting[] }> = [];
    if (args.nodes === "nodes-with-exports-only") {
      const pageId = typeof args.pageId === "string" && args.pageId ? requirePage(doc, args.pageId) : env.activePageId;
      for (const n of descendants(doc, doc.pages[pageId].rootId)) {
        const settings = (n.exports ?? []).filter((s) => !video || VIDEO_FORMATS.has(s.format));
        if (settings.length) requests.push({ nodeId: n.id, settings });
      }
      if (!requests.length) throw new ToolError(`No layer on page "${doc.pages[pageId].name}" has ${video ? "video " : ""}export settings. Pass a map of node ids to settings instead.`);
    } else if (args.nodes && typeof args.nodes === "object") {
      for (const [id, settings] of Object.entries(args.nodes as Record<string, ExportSetting[]>)) {
        const node = requireNode(doc, id);
        if (node.type === "Root") throw new ToolError("Page roots cannot be exported. Pass artboard ids.");
        const list = asArray<ExportSetting>(settings);
        const own = (node.exports ?? []).filter((s) => !video || VIDEO_FORMATS.has(s.format));
        requests.push({ nodeId: id, settings: list.length ? list : own.length ? own : [fallback] });
      }
    } else throw new ToolError('Pass nodes as {"<nodeId>": [{"format": "png", "scale": "2x"}]} or "nodes-with-exports-only".');

    const errors: string[] = [];
    if (video) {
      for (const r of requests) {
        const images = r.settings.filter((s) => !VIDEO_FORMATS.has(s.format));
        if (images.length) errors.push(`${r.nodeId}: ${images.map((s) => s.format).join(", ")} is not a video format, so it was skipped. Use "mp4" or "webm" with type "video".`);
        r.settings = r.settings.filter((s) => VIDEO_FORMATS.has(s.format));
      }
    }
    const kept = requests.filter((r) => r.settings.length);
    const result = kept.length ? await env.exportNodes(kept) : { files: [], errors: [], warnings: [] };
    errors.push(...result.errors);
    if (!result.files.length) throw new ToolError(`Nothing was exported. ${errors.join(" ")}`);
    const out: Record<string, unknown> = { exports: result.files, count: result.files.length };
    if (result.warnings?.length) out.warnings = result.warnings;
    if (errors.length) out.errors = errors;
    return [out];
  },
};

const export_combined_pdf: EditorTool = {
  write: false,
  page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
  label: () => "Exporting PDF",
  async run(args, env) {
    const ids = [...new Set(asArray<string>(args.nodeIds))];
    for (const id of ids) {
      const node = requireNode(env.doc, id);
      if (node.type === "Root") throw new ToolError("Page roots cannot be exported. Pass artboard ids.");
      if (!node.visible) throw new ToolError(`Layer "${node.name}" is hidden, so it cannot be exported.`);
    }
    const { path, pages, warning } = await env.exportCombinedPdf(ids);
    const out: Record<string, unknown> = { path, pageCount: pages.length, pages: pages.map((id) => ({ id, name: getNode(env.doc, id)?.name })) };
    if (warning) out.warnings = [warning];
    return [out];
  },
};

const finish_working_on_nodes: EditorTool = {
  write: false,
  label: () => "Finished",
  run(args, env) {
    const doc = env.doc;
    const work = env.agentWork();
    let ids: NodeId[];
    if (Array.isArray(args.nodeIds) && args.nodeIds.length) {
      ids = [...new Set(asArray<string>(args.nodeIds).map((id) => (getNode(doc, id) ? (artboardOf(doc, id)?.id ?? id) : id)))];
    } else {
      ids = Object.entries(work)
        .filter(([, w]) => w.client === env.client.name)
        .map(([id]) => id);
    }
    const released = ids.filter((id) => work[id]);
    env.releaseWork(released);
    return [
      {
        released: released.map((id) => ({ id, name: getNode(doc, id)?.name ?? null })),
        message: released.length ? "The agent working indicator is cleared." : "Nothing was marked as being worked on.",
      },
    ];
  },
};

export const outputTools: Record<string, EditorTool> = { export: exportTool, export_combined_pdf, finish_working_on_nodes };
