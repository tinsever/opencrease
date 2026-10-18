// Vector operations on layers: booleans, flatten, outline stroke and convert to path.
// Geometry comes from the document model plus measured world rects, so the same code serves the
// inspector and the agent tools. Boolean maths is done by paper.js (headless, no canvas needed).
import paper from "paper";
import { expandStroke } from "./stroke";
import { pageOfNode, type FoldDocument, type NodeId, type NodeTree, type OFNode, type StyleMap, type Tx } from "@opencrease/model";
import { isAbsolutelyPositioned, isFlex, isLockedDeep, sortByDocumentOrder, topmostOnly } from "../canvas/selection-logic";
import { multiply, parsePath, serializePath, transformPath, type Matrix, type PathModel, type Pt } from "./path";
import { pathAttrsFor, pathTree } from "./shapes";
import { elementPath, elementToSvgBox, isPaintNone, ownerSvg, paintOf, shapeElements, stylePx, type Paint } from "./svg-geom";

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";
export const BOOLEAN_OPS: BooleanOp[] = ["union", "subtract", "intersect", "exclude"];
export type FlattenOp = "flatten" | "outline-stroke" | "convert-to-path";

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpsEnv {
  doc: FoldDocument;
  /** world rect of a rendered node */
  measure(id: NodeId): WorldRect | null;
  /** world origin that left/top of an absolutely positioned child of `parentId` are relative to */
  origin(parentId: NodeId): Pt;
  /** Optional measured SVG user-space to world matrix (including CSS transforms). */
  matrix?(id: NodeId): Matrix | null;
}

export class VectorOpError extends Error {}

const OP_NAMES: Record<BooleanOp, string> = { union: "Union", subtract: "Subtract", intersect: "Intersect", exclude: "Exclude" };

// ------------------------------------------------------------------ operands

/** Layers that can take part in vector operations. */
export function isVectorOperand(node: OFNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "SVG") return true;
  if (node.type === "SVGElement") return node.tag === "g" || ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(node.tag ?? "");
  return node.type === "Rectangle";
}

interface Shape {
  /** world-space geometry */
  path: PathModel;
  paint: Paint;
  /** Original geometry and affine transform, so stroke outlines also survive nonuniform scaling. */
  source: PathModel;
  matrix: Matrix;
}

interface Operand {
  id: NodeId;
  /** the layer that holds the operand on its parent (an SVG node or a box) */
  layer: OFNode;
  shapes: Shape[];
}

function boxPaint(node: OFNode): Paint {
  const bg = node.styles.backgroundColor ?? node.styles.background;
  return { fill: typeof bg === "string" && bg ? bg : "#D9D9D9", stroke: "none", strokeWidth: 1 };
}

function radiusOf(node: OFNode, w: number, h: number): number {
  const r = stylePx(node.styles.borderRadius);
  return r ? Math.min(r, w / 2, h / 2) : 0;
}

function operandOf(env: OpsEnv, id: NodeId): Operand | null {
  const doc = env.doc;
  const node = doc.nodes[id];
  if (!node || !isVectorOperand(node)) return null;
  if (node.type === "Rectangle") {
    const r = env.measure(id);
    if (!r) return null;
    const rad = radiusOf(node, r.width, r.height);
    const el = { tag: "rect", attrs: { x: String(r.x), y: String(r.y), width: String(r.width), height: String(r.height), rx: String(rad) } };
    const path = elementPath(el)!;
    return { id, layer: node, shapes: [{ path, source: path, matrix: [1, 0, 0, 1, 0, 0], paint: boxPaint(node) }] };
  }
  const svg = ownerSvg(doc, id);
  if (!svg) return null;
  const rect = env.measure(svg.id);
  if (!rect) return null;
  const shapes: Shape[] = [];
  for (const el of shapeElements(doc, id)) {
    const geom = elementPath(el);
    if (!geom || geom.length === 0) continue;
    const m: Matrix = env.matrix?.(el.id) ?? multiply([1, 0, 0, 1, rect.x, rect.y], elementToSvgBox(doc, el.id, { width: rect.width, height: rect.height }));
    shapes.push({ path: transformPath(geom, m), source: geom, matrix: m, paint: paintOf(doc, el) });
  }
  if (!shapes.length) return null;
  return { id, layer: svg, shapes };
}

/** Reject effects that cannot be represented by a detached path, before changing any source layer. */
function validateGeometry(doc: FoldDocument, id: NodeId) {
  const visit = (node: OFNode) => {
    if (isLockedDeep(doc, node.id)) throw new VectorOpError(`Layer "${node.name}" is locked.`);
    if (!node.visible) return;
    if (node.tag === "defs" || node.tag === "title" || node.tag === "desc") return;
    if (node.type === "SVGElement" && node.tag !== "g" && !["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"].includes(node.tag ?? "")) {
      throw new VectorOpError(`Convert "${node.tag}" content to paths before combining this SVG.`);
    }
    for (const value of [...Object.values(node.styles), ...Object.values(node.attrs ?? {})]) {
      if (typeof value === "string" && /url\(/i.test(value)) throw new VectorOpError("Vector operations on gradients, masks and clipping references are not supported. Use solid, unclipped shapes.");
    }
    for (const child of node.children) visit(doc.nodes[child]);
  };
  visit(doc.nodes[id]);
  // A selected inner shape can inherit a referenced paint or clipping effect.
  for (let n = doc.nodes[id].parentId ? doc.nodes[doc.nodes[id].parentId!] : undefined; n?.type === "SVGElement" || n?.type === "SVG"; n = n.parentId ? doc.nodes[n.parentId] : undefined) {
    if ([...Object.values(n.styles), ...Object.values(n.attrs ?? {})].some((v) => typeof v === "string" && /url\(/i.test(v))) {
      throw new VectorOpError("Detach inherited gradients, masks and clipping references before combining this shape.");
    }
  }
}

function operands(env: OpsEnv, ids: NodeId[]): Operand[] {
  const doc = env.doc;
  const clean = sortByDocumentOrder(doc, topmostOnly(doc, ids.filter((id) => doc.nodes[id])));
  const out: Operand[] = [];
  if (new Set(clean.map((id) => pageOfNode(doc, id)?.id)).size > 1) throw new VectorOpError("Vector operations require layers on the same page.");
  for (const id of clean) {
    if (isLockedDeep(doc, id)) throw new VectorOpError(`Layer "${doc.nodes[id].name}" is locked.`);
    validateGeometry(doc, id);
    const op = operandOf(env, id);
    if (!op) throw new VectorOpError(`Layer "${doc.nodes[id]?.name ?? id}" has no supported vector geometry.`);
    out.push(op);
  }
  return out;
}

// ------------------------------------------------------------------ paper.js bridge

let paperReady = false;
function ensurePaper() {
  if (paperReady) return;
  paper.setup(new paper.Size(1, 1));
  paperReady = true;
}

function toItem(path: PathModel, fillRule?: string): paper.PathItem {
  ensurePaper();
  const item = new paper.CompoundPath({ pathData: serializePath(path, 4), insert: false });
  item.fillRule = fillRule === "evenodd" ? "evenodd" : "nonzero";
  return item;
}

function fromItem(item: paper.PathItem): PathModel {
  return parsePath(item.pathData);
}

function shapeItem(shapes: Shape[]): paper.PathItem {
  // one operand with several shapes paints their union
  let acc: paper.PathItem | null = null;
  for (const s of shapes) {
    const item = toItem(s.path, s.paint.fillRule);
    acc = acc ? acc.unite(item, { insert: false }) : item;
  }
  return acc!;
}

// ------------------------------------------------------------------ placement

interface Placement {
  parentId: NodeId;
  index: number;
  styles(origin: Pt): StyleMap;
}

/** Where a result replacing `layer` goes: same parent, just above it, positioned at a world origin. */
function placementFor(env: OpsEnv, layer: OFNode): Placement {
  const doc = env.doc;
  const parentId = layer.parentId!;
  const parent = doc.nodes[parentId];
  const index = parent.children.indexOf(layer.id) + 1;
  const onPage = parent.type === "Root";
  const flow = !onPage && isFlex(parent) && !isAbsolutelyPositioned(doc, layer);
  return {
    parentId,
    index,
    styles(o): StyleMap {
      if (onPage) return { left: round(o.x), top: round(o.y) };
      if (flow) return { flexShrink: 0 };
      const base = env.origin(parentId);
      return { position: "absolute", left: round(o.x - base.x), top: round(o.y - base.y) };
    },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function paintAttrs(p: Paint, opts: { fill?: string; stroke?: boolean } = {}): Record<string, string> {
  const attrs: Record<string, string> = {};
  attrs.fill = opts.fill ?? p.fill;
  if (p.fillOpacity) attrs["fill-opacity"] = p.fillOpacity;
  if (p.strokeOpacity) attrs["stroke-opacity"] = p.strokeOpacity;
  if (p.color) attrs.color = p.color;
  if (p.opacity) attrs.opacity = p.opacity;
  if (opts.stroke !== false && !isPaintNone(p.stroke)) {
    attrs.stroke = p.stroke;
    attrs["stroke-width"] = String(round(p.strokeWidth));
    if (p.strokeLinecap) attrs["stroke-linecap"] = p.strokeLinecap;
    if (p.strokeLinejoin) attrs["stroke-linejoin"] = p.strokeLinejoin;
    if (p.strokeDasharray) attrs["stroke-dasharray"] = p.strokeDasharray;
    if (p.strokeDashoffset) attrs["stroke-dashoffset"] = String(p.strokeDashoffset);
    if (p.strokeMiterlimit) attrs["stroke-miterlimit"] = String(p.strokeMiterlimit);
  }
  return attrs;
}

export interface OpResult {
  created: NodeId[];
  removed: NodeId[];
}

/** Delete operands, and SVG layers left without any shapes. */
function removeOperands(tx: Tx, ops: Operand[]): NodeId[] {
  const removed: NodeId[] = [];
  for (const op of ops) {
    if (!tx.doc.nodes[op.id]) continue;
    tx.deleteNode(op.id);
    removed.push(op.id);
    const layer = tx.doc.nodes[op.layer.id];
    if (layer && layer.type === "SVG" && shapeElements(tx.doc, layer.id).length === 0) {
      tx.deleteNode(layer.id);
      removed.push(layer.id);
    }
  }
  return removed;
}

function insertResult(tx: Tx, place: Placement, built: { tree: NodeTree; origin: Pt }): NodeId {
  const tree: NodeTree = { ...built.tree, styles: { ...built.tree.styles, ...place.styles(built.origin) } };
  const parent = tx.doc.nodes[place.parentId];
  const index = Math.min(place.index, parent.children.length);
  return tx.insertTrees(place.parentId, [tree], index)[0];
}

// ------------------------------------------------------------------ operations

/** Combine two or more vector layers into one path. The bottom-most layer's paint wins. */
export function booleanOp(env: OpsEnv, tx: Tx, ids: NodeId[], op: BooleanOp): OpResult {
  const ops = operands(env, ids);
  if (ops.length < 2) throw new VectorOpError("Boolean operations need at least two vector layers (SVG, path, shape or rectangle).");
  const items = ops.map((o) => shapeItem(o.shapes));
  let result = items[0];
  if (op === "subtract") {
    let others = items[1];
    for (let i = 2; i < items.length; i++) others = others.unite(items[i], { insert: false });
    result = result.subtract(others, { insert: false });
  } else {
    for (let i = 1; i < items.length; i++) {
      const b = items[i];
      result = op === "union" ? result.unite(b, { insert: false }) : op === "intersect" ? result.intersect(b, { insert: false }) : result.exclude(b, { insert: false });
    }
  }
  const path = fromItem(result);
  const bottom = ops[0];
  const attrs = paintAttrs(bottom.shapes[0].paint);
  if (op === "exclude") attrs["fill-rule"] = "evenodd";
  if (isPaintNone(attrs.fill) && isPaintNone(attrs.stroke)) attrs.fill = "#D9D9D9";
  const place = placementFor(env, bottom.layer);
  const built = pathTree(path, attrs, OP_NAMES[op]);
  if (!built) {
    // nothing left (e.g. intersecting shapes that do not overlap)
    throw new VectorOpError(`The ${op} of these layers is empty, so nothing was changed.`);
  }
  const id = insertResult(tx, place, built);
  const removed = removeOperands(tx, ops);
  return { created: [id], removed };
}

/** Merge vector layers into a single path layer without changing their geometry. */
export function flatten(env: OpsEnv, tx: Tx, ids: NodeId[]): OpResult {
  const ops = operands(env, ids);
  if (ops.length === 0) throw new VectorOpError("Select vector layers (SVG, path, shape or rectangle) to flatten.");
  const path = ops.flatMap((o) => o.shapes.flatMap((s) => s.path));
  const bottom = ops[0];
  const paint = bottom.shapes[0].paint;
  const place = placementFor(env, bottom.layer);
  const attrs = paintAttrs(paint);
  if (paint.fillRule) attrs["fill-rule"] = paint.fillRule;
  const built = pathTree(path, attrs, bottom.layer.name || "Vector");
  if (!built) throw new VectorOpError("These layers have no geometry to flatten.");
  const id = insertResult(tx, place, built);
  const removed = removeOperands(tx, ops);
  return { created: [id], removed };
}

/** Turn strokes into filled outlines. Layers without a stroke are left alone. */
export function outlineStroke(env: OpsEnv, tx: Tx, ids: NodeId[]): OpResult {
  const ops = operands(env, ids).filter((o) => o.shapes.some((s) => !isPaintNone(s.paint.stroke) && s.paint.strokeWidth > 0));
  if (ops.length === 0) throw new VectorOpError("None of these layers has a stroke to outline.");
  const created: NodeId[] = [];
  const all: Operand[] = [];
  for (const op of ops) {
    const children: Array<{ path: PathModel; attrs: Record<string, string> }> = [];
    for (const s of op.shapes) {
      if (!isPaintNone(s.paint.fill) && s.path.some((sp) => sp.closed || sp.anchors.length > 2)) {
        children.push({ path: s.path, attrs: { ...paintAttrs(s.paint, { stroke: false }), ...(s.paint.fillRule ? { "fill-rule": s.paint.fillRule } : {}) } });
      }
      if (isPaintNone(s.paint.stroke) || s.paint.strokeWidth <= 0) continue;
      ensurePaper();
      const item = toItem(s.source);
      let outline: paper.PathItem;
      try {
        outline = expandStroke(item, s.paint);
      } catch {
        throw new VectorOpError(`Could not outline the stroke of "${op.layer.name}".`);
      }
      children.push({ path: transformPath(fromItem(outline), s.matrix), attrs: { fill: s.paint.stroke, ...(s.paint.color ? { color: s.paint.color } : {}), ...(s.paint.strokeOpacity ? { "fill-opacity": s.paint.strokeOpacity } : {}), ...(s.paint.opacity ? { opacity: s.paint.opacity } : {}) } });
    }
    const whole = children.flatMap((c) => c.path);
    const built = pathTree(whole, {}, op.layer.name || "Outline");
    if (!built) continue;
    // one path per paint, all translated into the same box
    const dx = -built.origin.x;
    const dy = -built.origin.y;
    built.tree.children = children.map((c) => ({
      type: "SVGElement" as const,
      tag: "path",
      attrs: { d: serializePath(transformPath(c.path, [1, 0, 0, 1, dx, dy]), 2), ...c.attrs },
    }));
    const place = placementFor(env, op.layer);
    created.push(insertResult(tx, place, built));
    all.push(op);
  }
  const removed = removeOperands(tx, all);
  return { created, removed };
}

/** Replace primitive shapes (rect, ellipse, polygon, star, line) with equivalent paths. Boxes become path layers. */
export function convertToPath(env: OpsEnv, tx: Tx, ids: NodeId[]): OpResult {
  const doc = env.doc;
  const created: NodeId[] = [];
  const removed: NodeId[] = [];
  let changed = 0;
  for (const id of topmostOnly(doc, ids)) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (isLockedDeep(doc, id)) throw new VectorOpError(`Layer "${node.name}" is locked.`);
    if (node.type === "Rectangle") {
      const op = operandOf(env, id);
      if (!op) continue;
      const built = pathTree(op.shapes[0].path, { fill: op.shapes[0].paint.fill }, node.name || "Rectangle");
      if (!built) continue;
      created.push(insertResult(tx, placementFor(env, node), built));
      tx.deleteNode(id);
      removed.push(id);
      changed++;
      continue;
    }
    for (const el of shapeElements(doc, id)) {
      if (isLockedDeep(doc, el.id)) throw new VectorOpError(`Layer "${el.name}" is locked.`);
      if (el.tag === "path") continue;
      const geom = elementPath(el);
      if (!geom) continue;
      tx.updateNode(el.id, { tag: "path", attrs: pathAttrsFor(el, geom), name: el.name && el.name !== capital(el.tag ?? "") ? el.name : "Path" });
      changed++;
    }
  }
  if (!changed) throw new VectorOpError("Nothing to convert: select shapes, rectangles or SVG layers with primitive shapes.");
  return { created, removed };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function runFlattenOp(env: OpsEnv, tx: Tx, ids: NodeId[], op: FlattenOp): OpResult {
  if (op === "outline-stroke") return outlineStroke(env, tx, ids);
  if (op === "convert-to-path") return convertToPath(env, tx, ids);
  return flatten(env, tx, ids);
}
