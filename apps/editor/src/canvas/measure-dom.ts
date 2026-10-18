// DOM-backed geometry for the canvas: rotated boxes of rendered nodes and the start boxes that
// constraints need when a parent is resized.
import type { FoldDocument, NodeId, OFNode, StyleValue, Tx } from "@opencrease/model";
import { resizeConstraintPatches } from "./resize-constraints";
import type { Rect } from "./geometry";
import { constrainedChildren, constraintPatches, type ChildBox, type Size } from "./constraints";
import { getNodeElement, getWorldRect } from "./registry";
import { boxFromRect, boxLocalRect, rotatePoint, normAngle, parseAngle, type OrientedBox } from "./transform";

/** Rotation of a node in world space: its own `rotate` plus its ancestors'. */
export function worldAngle(doc: FoldDocument, id: NodeId): number {
  let a = 0;
  let cur: OFNode | undefined = doc.nodes[id];
  while (cur && cur.type !== "Root") {
    a += parseAngle(cur.styles.rotate);
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return normAngle(a);
}

/** The rotated box of a rendered node: centre from its bounds, size from its layout box. */
export function orientedBox(doc: FoldDocument, id: NodeId): OrientedBox | null {
  const r = getWorldRect(id);
  if (!r) return null;
  const angle = worldAngle(doc, id);
  if (Math.abs(angle) < 0.01) return boxFromRect(r, 0);
  const el = getNodeElement(id);
  const width = el instanceof HTMLElement ? el.offsetWidth : r.width;
  const height = el instanceof HTMLElement ? el.offsetHeight : r.height;
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, width, height, angle };
}

/** Unrotated rect (the CSS layout box) of a node in world space. */
export function layoutRect(doc: FoldDocument, id: NodeId) {
  const b = orientedBox(doc, id);
  return b ? boxLocalRect(b) : null;
}

/** Padding-box origin of a parent (inside its border), world space. */
function paddingOrigin(doc: FoldDocument, id: NodeId): { x: number; y: number } | null {
  const r = layoutRect(doc, id);
  if (!r) return null;
  const el = getNodeElement(id);
  return { x: r.x + (el?.clientLeft ?? 0), y: r.y + (el?.clientTop ?? 0) };
}

/** Padding-box size of a node (what its absolute children are laid out against). */
export function paddingSize(doc: FoldDocument, id: NodeId): Size | null {
  const r = layoutRect(doc, id);
  if (!r) return null;
  const el = getNodeElement(id);
  const bx = el ? el.offsetWidth - el.clientWidth : 0;
  const by = el ? el.offsetHeight - el.clientHeight : 0;
  return { width: Math.max(0, r.width - bx), height: Math.max(0, r.height - by) };
}

/**
 * Measure, before a resize starts, every constrained descendant of `ids` (recursively through children
 * whose size may change), relative to their parent's padding box.
 */
export function snapshotConstraintBoxes(doc: FoldDocument, ids: NodeId[]): Map<NodeId, ChildBox> {
  const out = new Map<NodeId, ChildBox>();
  const walk = (parentId: NodeId, depth: number) => {
    if (depth > 32) return;
    const kids = constrainedChildren(doc, parentId);
    if (kids.length === 0) return;
    const o = paddingOrigin(doc, parentId);
    if (!o) return;
    for (const k of kids) {
      const r = layoutRect(doc, k.id);
      if (!r) continue;
      const el = getNodeElement(k.id);
      out.set(k.id, { left: el?.offsetLeft ?? r.x - o.x, top: el?.offsetTop ?? r.y - o.y, width: r.width, height: r.height });
      walk(k.id, depth + 1);
    }
  };
  for (const id of ids) walk(id, 0);
  return out;
}

/** Inside a transaction: move and size the constrained children of `id` for its new size. */
export function applyConstraintsTx(tx: Tx, doc: FoldDocument, id: NodeId, from: Size, to: Size, boxes: Map<NodeId, ChildBox>) {
  for (const p of constraintPatches(doc, id, from, to, (cid) => boxes.get(cid) ?? null)) {
    if (tx.doc.nodes[p.id]) tx.setStyles(p.id, p.styles);
  }
}

/** World displacement expressed in the node parent's CSS coordinate system. */
export function parentDelta(doc: FoldDocument, id: NodeId, delta: { x: number; y: number }) {
  const parent = doc.nodes[id]?.parentId;
  return rotatePoint(delta, { x: 0, y: 0 }, parent ? -worldAngle(doc, parent) : 0);
}

/** CSS left/top change for transformed boxes, including rotated ancestors. */
export function positionDelta(doc: FoldDocument, id: NodeId, from: OrientedBox, to: OrientedBox) {
  const d = parentDelta(doc, id, { x: to.cx - from.cx, y: to.cy - from.cy });
  return { x: d.x - (to.width - from.width) / 2, y: d.y - (to.height - from.height) / 2 };
}

/**
 * Resolve a size write with the browser before committing it, so constraints also follow percentages,
 * tokens, intrinsic sizes and bordered parents. The temporary inline dimensions are restored before
 * the transaction; no document mutation or extra undo step is needed. Pure/model-only callers use the
 * authored-size fallback.
 */
export function styleConstraintPatches(doc: FoldDocument, id: NodeId, patch: Record<string, StyleValue | null>, measure: (id: NodeId) => Rect | null) {
  const el = getNodeElement(id);
  if (!("width" in patch || "height" in patch) || typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) {
    return resizeConstraintPatches(doc, id, patch, measure);
  }
  const from = { width: el.clientWidth, height: el.clientHeight };
  const boxes = snapshotConstraintBoxes(doc, [id]);
  const before = { width: el.style.width, height: el.style.height };
  try {
    for (const axis of ["width", "height"] as const) {
      if (!(axis in patch)) continue;
      const value = patch[axis];
      el.style[axis] = value === null ? "" : typeof value === "number" ? `${value}px` : value;
    }
    const to = { width: el.clientWidth, height: el.clientHeight };
    return constraintPatches(doc, id, from, to, (cid) => boxes.get(cid) ?? null);
  } finally {
    el.style.width = before.width;
    el.style.height = before.height;
  }
}
