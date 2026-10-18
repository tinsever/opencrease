// Pure, document-level rules for canvas selection and layout classification.
import { ancestors, canHaveChildren, type FoldDocument, type NodeId, type OFNode } from "@opencrease/model";

export function isRootChild(doc: FoldDocument, node: OFNode): boolean {
  return node.parentId !== null && doc.nodes[node.parentId]?.type === "Root";
}

/** Artboards are Frames directly under a page Root. */
export function isArtboardNode(doc: FoldDocument, node: OFNode): boolean {
  return node.type === "Frame" && isRootChild(doc, node);
}

export function isFlex(node: OFNode | undefined): boolean {
  if (!node) return false;
  const d = node.styles.display;
  return d === "flex" || d === "inline-flex";
}

export function flexAxis(node: OFNode | undefined): "row" | "column" {
  const dir = String(node?.styles.flexDirection ?? "row");
  return dir.startsWith("column") ? "column" : "row";
}

/** Nodes positioned with left/top: page-level layers and `position: absolute` children. */
export function isAbsolutelyPositioned(doc: FoldDocument, node: OFNode): boolean {
  if (node.parentId === null) return false;
  if (isRootChild(doc, node)) return true;
  return node.styles.position === "absolute" || node.styles.position === "fixed";
}

/** Can new layers be dropped or drawn into this node? */
export function isContainer(node: OFNode | undefined): boolean {
  return !!node && (node.type === "Frame" || node.type === "Root") && canHaveChildren(node.type);
}

/** True if this node or one of its ancestors is locked. */
export function isLockedDeep(doc: FoldDocument, id: NodeId): boolean {
  const node = doc.nodes[id];
  if (!node) return false;
  if (node.locked) return true;
  return ancestors(doc, id).some((a) => a.locked);
}

/** Ancestor chain from `id` up to (excluding) the Root: [id, parent, ..., top-level]. */
export function chainToTop(doc: FoldDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let cur: OFNode | undefined = doc.nodes[id];
  while (cur && cur.type !== "Root") {
    out.push(cur.id);
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return out;
}

export type PickMode = "normal" | "deep" | "drill";

/**
 * Which node a click selects, given the innermost hit node.
 *
 * - "deep" (Cmd-click) picks the innermost node.
 * - "normal" picks the deepest node in the hit chain whose parent is "open": an artboard, or a strict
 *   ancestor of the current selection (so siblings of selected layers stay one click away).
 * - "drill" (double-click) also treats selected nodes as open, going one level further in.
 *
 * Returns null for a click on an artboard's own background when it has children (the caller deselects or
 * starts a marquee), the top-level layer for loose layers.
 */
export function pickTarget(doc: FoldDocument, innermost: NodeId, selection: NodeId[], mode: PickMode = "normal"): NodeId | null {
  const chain = chainToTop(doc, innermost);
  if (chain.length === 0) return null;
  if (mode === "deep") return chain[0];

  const open = new Set<NodeId>();
  for (const id of selection) {
    if (!doc.nodes[id]) continue;
    for (const a of ancestors(doc, id)) if (a.type !== "Root") open.add(a.id);
    if (mode === "drill") open.add(id);
  }
  const top = doc.nodes[chain[chain.length - 1]];
  if (isArtboardNode(doc, top)) open.add(top.id);

  for (const id of chain) {
    const parentId = doc.nodes[id].parentId;
    if (parentId && open.has(parentId)) return id;
  }
  // nothing open was hit: either a loose layer or an artboard background
  if (isArtboardNode(doc, top) && top.children.length > 0) return null;
  return top.id;
}

/** "Fill" / "Hug" label for one axis of a node, or null when the size is fixed. */
export function sizeIntent(doc: FoldDocument, node: OFNode, axis: "width" | "height"): "Fill" | "Hug" | null {
  const value = node.styles[axis];
  if (value === "fit-content" || value === "max-content" || value === "min-content") return "Hug";
  if (value === "100%") return "Fill";
  if (node.type === "Root" || node.type === "SVGElement") return null;
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  const fixed = typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?px$/.test(value));
  if (!parent || parent.type === "Root") {
    if (fixed || value !== undefined) return null;
    return node.type === "Frame" || node.type === "Text" ? "Hug" : null;
  }
  const absolute = node.styles.position === "absolute" || node.styles.position === "fixed";
  if (isFlex(parent) && !absolute) {
    const main = flexAxis(parent) === "row" ? "width" : "height";
    if (axis === main) {
      if (Number(node.styles.flexGrow ?? 0) > 0) return "Fill";
    } else {
      const self = node.styles.alignSelf;
      const items = parent.styles.alignItems;
      if (self === "stretch" && !fixed) return "Fill";
      if (value === undefined && (self === undefined || self === "auto" || self === "normal") && (items === undefined || items === "stretch" || items === "normal")) {
        return node.type === "Image" ? null : "Fill";
      }
    }
    if (fixed || value !== undefined) return null;
    return node.type === "Frame" || node.type === "Text" ? "Hug" : null;
  }
  if (fixed || value !== undefined) return null;
  if (axis === "width" && !absolute && node.type !== "Image" && node.type !== "SVG") return "Fill";
  return node.type === "Frame" || node.type === "Text" ? "Hug" : null;
}

/** Siblings at the level of the current selection (for Cmd+A and Tab). */
export function selectionLevel(doc: FoldDocument, rootId: NodeId, selection: NodeId[]): NodeId[] {
  const first = selection.map((id) => doc.nodes[id]).find(Boolean);
  const parent = first?.parentId ? doc.nodes[first.parentId] : doc.nodes[rootId];
  if (!parent) return [];
  return parent.children.filter((id) => {
    const n = doc.nodes[id];
    return n && n.visible && !n.locked;
  });
}

/** Keep only the topmost nodes: drop any node whose ancestor is also in the list. */
export function topmostOnly(doc: FoldDocument, ids: NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestors(doc, id).some((a) => set.has(a.id)));
}

/** Sort ids in document (paint) order. */
export function sortByDocumentOrder(doc: FoldDocument, ids: NodeId[]): NodeId[] {
  const path = (id: NodeId): number[] => {
    const out: number[] = [];
    let cur = doc.nodes[id];
    while (cur?.parentId) {
      const parent = doc.nodes[cur.parentId];
      if (!parent) break;
      out.unshift(parent.children.indexOf(cur.id));
      cur = parent;
    }
    return out;
  };
  const keyed = ids.map((id) => ({ id, p: path(id) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < Math.max(a.p.length, b.p.length); i++) {
      const d = (a.p[i] ?? -1) - (b.p[i] ?? -1);
      if (d) return d;
    }
    return 0;
  });
  return keyed.map((k) => k.id);
}

/** Parse a numeric px style value. */
export function pxValue(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/);
    if (m) return Number(m[1]);
  }
  return undefined;
}
