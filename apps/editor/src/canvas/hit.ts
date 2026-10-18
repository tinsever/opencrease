// DOM hit testing: map points to node ids using document.elementsFromPoint and data-of-id.
import { ancestors, type FoldDocument, type NodeId } from "@opencrease/model";
import { getWorldElement } from "./registry";
import { isContainer } from "./selection-logic";

export interface HitOptions {
  /** ignore these nodes and their descendants */
  exclude?: Set<NodeId>;
  /** include locked nodes (default false: locked layers are click-through) */
  includeLocked?: boolean;
}

function nodeIdOf(el: Element, world: HTMLElement): NodeId | null {
  const owner = el.closest("[data-of-id]");
  if (!owner || !world.contains(owner)) return null;
  return owner.getAttribute("data-of-id");
}

function acceptable(doc: FoldDocument, id: NodeId, opts: HitOptions): boolean {
  const node = doc.nodes[id];
  if (!node || node.type === "Root") return false;
  const chain = [node, ...ancestors(doc, id)];
  for (const n of chain) {
    if (!opts.includeLocked && n.locked) return false;
    if (opts.exclude?.has(n.id)) return false;
  }
  return true;
}

/** Distinct node ids under a client point, topmost first. */
export function hitIds(doc: FoldDocument, clientX: number, clientY: number, opts: HitOptions = {}): NodeId[] {
  const world = getWorldElement();
  if (!world) return [];
  const out: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!world.contains(el)) continue;
    const id = nodeIdOf(el, world);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (acceptable(doc, id, opts)) out.push(id);
  }
  return out;
}

/** The innermost, topmost node under a point. */
export function innermostAt(doc: FoldDocument, clientX: number, clientY: number, opts: HitOptions = {}): NodeId | null {
  return hitIds(doc, clientX, clientY, opts)[0] ?? null;
}

/** Deepest container (Frame) under a point, or null for empty canvas. */
export function containerAt(doc: FoldDocument, clientX: number, clientY: number, opts: HitOptions = {}): NodeId | null {
  const hit = innermostAt(doc, clientX, clientY, opts);
  if (!hit) return null;
  for (const n of [doc.nodes[hit], ...ancestors(doc, hit)]) {
    if (n.type === "Root") return null;
    if (isContainer(n) && !n.locked) return n.id;
  }
  return null;
}
