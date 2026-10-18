// Helpers shared by the tool implementations.
import {
  artboardOf, getNode, getPage, listPages, pageOfNode,
  type FoldDocument, type NodeId, type OFNode, type PageId,
} from "@opencrease/model";
import { ToolError, type ToolEnv, type WorldRect } from "../env";
import { pxNumber, round } from "../match";
import type { Rect } from "../placement";

export function requireNode(doc: FoldDocument, id: unknown): OFNode {
  const nodeId = String(id ?? "");
  const node = nodeId ? getNode(doc, nodeId) : undefined;
  if (!node) throw new ToolError(`No node with id "${nodeId}" in this file. Use get_tree_summary or find_nodes to look up ids.`);
  return node;
}

export function requirePage(doc: FoldDocument, id: unknown): PageId {
  const pageId = String(id ?? "");
  if (!getPage(doc, pageId)) {
    const ids = listPages(doc).map((p) => `${p.id} ("${p.name}")`).join(", ");
    throw new ToolError(`No page with id "${pageId}". Pages in this file: ${ids}.`);
  }
  return pageId;
}

export function assertUnlocked(doc: FoldDocument, node: OFNode, verb = "edit"): void {
  if (node.locked) throw new ToolError(`Layer "${node.name}" (${node.id}) is locked, so it cannot ${verb}. Ask the user to unlock it.`);
  for (let p = node.parentId ? getNode(doc, node.parentId) : undefined; p && p.type !== "Root"; p = p.parentId ? getNode(doc, p.parentId) : undefined) {
    if (p.locked) throw new ToolError(`Layer "${node.name}" (${node.id}) is inside the locked layer "${p.name}", so it cannot ${verb}. Ask the user to unlock it.`);
  }
}

export function rootIdOfPage(doc: FoldDocument, pageId: PageId): NodeId {
  return getPage(doc, pageId)!.rootId;
}

/** Size from the canvas, or from fixed px styles when the node is not measured. */
export function sizeOf(env: ToolEnv, node: OFNode, rect = env.measure(node.id)): { width: number | null; height: number | null } {
  if (rect) return { width: round(rect.width), height: round(rect.height) };
  return { width: pxNumber(node.styles.width) ?? null, height: pxNumber(node.styles.height) ?? null };
}

/** World position (and position in the parent) from the canvas, or from left/top of artboards. */
export function positionOf(env: ToolEnv, doc: FoldDocument, node: OFNode, rect = env.measure(node.id)): { worldX: number | null; worldY: number | null; x: number | null; y: number | null } {
  if (rect) {
    const parent = node.parentId ? getNode(doc, node.parentId) : undefined;
    if (!parent || parent.type === "Root") return { worldX: round(rect.x), worldY: round(rect.y), x: round(rect.x), y: round(rect.y) };
    const pr = env.measure(parent.id);
    return { worldX: round(rect.x), worldY: round(rect.y), x: pr ? round(rect.x - pr.x) : null, y: pr ? round(rect.y - pr.y) : null };
  }
  const parent = node.parentId ? getNode(doc, node.parentId) : undefined;
  if (parent?.type === "Root") {
    const x = pxNumber(node.styles.left) ?? null;
    const y = pxNumber(node.styles.top) ?? null;
    return { worldX: x, worldY: y, x, y };
  }
  return { worldX: null, worldY: null, x: null, y: null };
}

/** Rects of every top-level layer on a page (for placing new artboards). */
export function topLevelRects(env: ToolEnv, doc: FoldDocument, pageId: PageId, except: Set<NodeId> = new Set()): Rect[] {
  const root = getNode(doc, rootIdOfPage(doc, pageId));
  if (!root) return [];
  const out: Rect[] = [];
  for (const id of root.children) {
    if (except.has(id)) continue;
    const node = getNode(doc, id);
    if (!node) continue;
    const rect: WorldRect | null = env.measure(id);
    if (rect) {
      out.push(rect);
      continue;
    }
    const x = pxNumber(node.styles.left) ?? 0;
    const y = pxNumber(node.styles.top) ?? 0;
    out.push({ x, y, width: pxNumber(node.styles.width) ?? 0, height: pxNumber(node.styles.height) ?? 0 });
  }
  return out;
}

/** Page for a set of node ids (first one that exists). */
export function pageOfIds(doc: FoldDocument, ids: unknown[]): PageId | undefined {
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const page = getNode(doc, id) ? pageOfNode(doc, id) : undefined;
    if (page) return page.id;
  }
  return undefined;
}

export function artboardIdOf(doc: FoldDocument, id: NodeId): NodeId | undefined {
  return artboardOf(doc, id)?.id;
}

export function nameOf(doc: FoldDocument, id: NodeId | undefined): string {
  return (id && getNode(doc, id)?.name) || "layers";
}

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
