// Vector layers: SVG nodes built from paths and primitive shapes, their parameters, resizing and refitting.
// Pure document logic (no DOM). A "fitted" SVG has viewBox "0 0 W H" matching its width × height, so its
// user units are CSS pixels; everything OpenCrease draws is fitted, pasted SVGs usually are not.
import type { FoldDocument, NodeId, NodeTree, OFNode, StyleMap, Tx } from "@opencrease/model";
import { fmt, pathBounds, serializePath, transformPath, unionBounds, type Bounds, type PathModel, type Pt } from "./path";
import { attrNum, elementPath, parsePoints, parseViewBox, SHAPE_TAGS, stylePx } from "./svg-geom";

export type ShapeKind = "rect" | "ellipse" | "line" | "polygon" | "star";
export type VectorKind = ShapeKind | "path";

export const DEFAULT_SHAPE_FILL = "#D9D9D9";
export const DEFAULT_STROKE = "#000000";
export const DEFAULT_STROKE_WIDTH = 1.5;
export const DEFAULT_SIDES = 3;
export const DEFAULT_STAR_POINTS = 5;
export const DEFAULT_STAR_RATIO = 0.382;

// ------------------------------------------------------------------ polygon and star geometry

/** Map points so their bounds fill `box` exactly. */
function fitPoints(points: Pt[], box: Bounds): Pt[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  return points.map((p) => ({ x: box.x + ((p.x - minX) / w) * box.width, y: box.y + ((p.y - minY) / h) * box.height }));
}

/** Regular polygon with `sides` corners, first corner at the top, stretched to fill `box`. */
export function polygonPoints(sides: number, box: Bounds): Pt[] {
  const n = Math.max(3, Math.min(60, Math.round(sides)));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return fitPoints(pts, box);
}

/** Star with `points` tips and inner radius `ratio` (0..1 of the outer radius), stretched to fill `box`. */
export function starPoints(points: number, ratio: number, box: Bounds): Pt[] {
  const n = Math.max(3, Math.min(60, Math.round(points)));
  const r = Math.max(0.01, Math.min(1, ratio));
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 === 0 ? 1 : r;
    pts.push({ x: Math.cos(a) * k, y: Math.sin(a) * k });
  }
  return fitPoints(pts, box);
}

export function pointsAttr(points: Pt[]): string {
  return points.map((p) => `${fmt(p.x, 2)},${fmt(p.y, 2)}`).join(" ");
}

// ------------------------------------------------------------------ shape parameters

export interface ShapeParams {
  kind: VectorKind;
  sides?: number;
  points?: number;
  ratio?: number;
  /** corner radius (rect) */
  radius?: number;
}

/** What kind of vector an SVG element is, with its editable parameters. */
export function shapeParams(node: Pick<OFNode, "tag" | "attrs">): ShapeParams | null {
  const a = node.attrs ?? {};
  switch (node.tag) {
    case "rect":
      return { kind: "rect", radius: attrNum(node, "rx", attrNum(node, "ry", 0)) };
    case "ellipse":
    case "circle":
      return { kind: "ellipse" };
    case "line":
      return { kind: "line" };
    case "polygon":
      if (a["data-shape"] === "star") return { kind: "star", points: attrNum(node, "data-points", DEFAULT_STAR_POINTS), ratio: attrNum(node, "data-ratio", DEFAULT_STAR_RATIO) };
      if (a["data-shape"] === "polygon") return { kind: "polygon", sides: attrNum(node, "data-sides", DEFAULT_SIDES) };
      return { kind: "path" };
    case "path":
    case "polyline":
      return { kind: "path" };
    default:
      return null;
  }
}

/** New attributes for a polygon/star element after a parameter change, keeping its current box. */
export function regenerateShapeAttrs(node: Pick<OFNode, "tag" | "attrs">, params: { sides?: number; points?: number; ratio?: number }, box?: Bounds): Record<string, string> | null {
  const current = shapeParams(node);
  if (!current || (current.kind !== "polygon" && current.kind !== "star")) return null;
  const b = box ?? pathBounds(elementPath(node) ?? []) ?? { x: 0, y: 0, width: 100, height: 100 };
  const attrs = { ...(node.attrs ?? {}) };
  if (current.kind === "polygon") {
    const sides = Math.max(3, Math.min(60, Math.round(params.sides ?? current.sides ?? DEFAULT_SIDES)));
    attrs["data-sides"] = String(sides);
    attrs.points = pointsAttr(polygonPoints(sides, b));
  } else {
    const points = Math.max(3, Math.min(60, Math.round(params.points ?? current.points ?? DEFAULT_STAR_POINTS)));
    const ratio = Math.max(0.01, Math.min(1, params.ratio ?? current.ratio ?? DEFAULT_STAR_RATIO));
    attrs["data-points"] = String(points);
    attrs["data-ratio"] = fmt(ratio, 3);
    attrs.points = pointsAttr(starPoints(points, ratio, b));
  }
  return attrs;
}

// ------------------------------------------------------------------ building vector layers

const SHAPE_NAMES: Record<ShapeKind, string> = { rect: "Rectangle", ellipse: "Ellipse", line: "Line", polygon: "Polygon", star: "Star" };

/** Element for a shape filling a `w` × `h` box (line: from a to b, local coordinates). */
export function shapeElement(kind: ShapeKind, w: number, h: number, line?: { a: Pt; b: Pt }): NodeTree {
  const box = { x: 0, y: 0, width: w, height: h };
  switch (kind) {
    case "rect":
      return { type: "SVGElement", tag: "rect", attrs: { x: "0", y: "0", width: fmt(w, 2), height: fmt(h, 2), fill: DEFAULT_SHAPE_FILL } };
    case "ellipse":
      return { type: "SVGElement", tag: "ellipse", attrs: { cx: fmt(w / 2, 2), cy: fmt(h / 2, 2), rx: fmt(w / 2, 2), ry: fmt(h / 2, 2), fill: DEFAULT_SHAPE_FILL } };
    case "line": {
      const a = line?.a ?? { x: 0, y: h / 2 };
      const b = line?.b ?? { x: w, y: h / 2 };
      return {
        type: "SVGElement",
        tag: "line",
        attrs: { x1: fmt(a.x, 2), y1: fmt(a.y, 2), x2: fmt(b.x, 2), y2: fmt(b.y, 2), stroke: DEFAULT_STROKE, "stroke-width": String(DEFAULT_STROKE_WIDTH) },
      };
    }
    case "polygon":
      return { type: "SVGElement", tag: "polygon", attrs: { points: pointsAttr(polygonPoints(DEFAULT_SIDES, box)), fill: DEFAULT_SHAPE_FILL, "data-shape": "polygon", "data-sides": String(DEFAULT_SIDES) } };
    case "star":
      return {
        type: "SVGElement",
        tag: "polygon",
        attrs: {
          points: pointsAttr(starPoints(DEFAULT_STAR_POINTS, DEFAULT_STAR_RATIO, box)),
          fill: DEFAULT_SHAPE_FILL,
          "data-shape": "star",
          "data-points": String(DEFAULT_STAR_POINTS),
          "data-ratio": String(DEFAULT_STAR_RATIO),
        },
      };
  }
}

/** An SVG layer of `width` × `height` px whose user units are px. Position styles are added by the caller. */
export function vectorSvgTree(name: string, width: number, height: number, children: NodeTree[], styles: StyleMap = {}): NodeTree {
  const w = Math.max(width, 0.01);
  const h = Math.max(height, 0.01);
  return {
    type: "SVG",
    tag: "svg",
    name,
    attrs: { viewBox: `0 0 ${fmt(w, 2)} ${fmt(h, 2)}`, preserveAspectRatio: "none" },
    styles: { width: Number(fmt(w, 2)), height: Number(fmt(h, 2)), overflow: "visible", ...styles },
    children,
  };
}

export function shapeTree(kind: ShapeKind, width: number, height: number, line?: { a: Pt; b: Pt }): NodeTree {
  return vectorSvgTree(SHAPE_NAMES[kind], width, height, [shapeElement(kind, width, height, line)]);
}

/** Lines and other thin geometry still get a 1px box so the layer stays selectable. */
export function padBounds(b: Bounds, min = 1): Bounds {
  let { x, y, width, height } = b;
  if (width < min) {
    x -= (min - width) / 2;
    width = min;
  }
  if (height < min) {
    y -= (min - height) / 2;
    height = min;
  }
  return { x, y, width, height };
}

/**
 * Tree for a path given in world (or parent) coordinates: the SVG is sized to the path's bounds and
 * the path is translated into it. Returns the tree and the bounds' origin for positioning.
 */
export function pathTree(path: PathModel, attrs: Record<string, string>, name = "Path"): { tree: NodeTree; origin: Pt; bounds: Bounds } | null {
  const raw = pathBounds(path);
  if (!raw) return null;
  const b = padBounds(raw);
  const local = transformPath(path, [1, 0, 0, 1, -b.x, -b.y]);
  const tree = vectorSvgTree(name, b.width, b.height, [{ type: "SVGElement", tag: "path", attrs: { d: serializePath(local, 2), ...attrs } }]);
  return { tree, origin: { x: b.x, y: b.y }, bounds: b };
}

// ------------------------------------------------------------------ scaling and translating elements

/** Attributes of a shape element after x' = x * sx + tx, y' = y * sy + ty. Null when it cannot be done exactly. */
export function transformShapeAttrs(node: Pick<OFNode, "tag" | "attrs">, sx: number, sy: number, tx: number, ty: number): { tag?: string; attrs: Record<string, string> } | null {
  const a = { ...(node.attrs ?? {}) };
  if (a.transform) return null;
  const n = (k: string) => attrNum(node, k, 0);
  const X = (v: number) => fmt(v * sx + tx, 3);
  const Y = (v: number) => fmt(v * sy + ty, 3);
  switch (node.tag) {
    case "path": {
      const p = elementPath(node) ?? [];
      a.d = serializePath(transformPath(p, [sx, 0, 0, sy, tx, ty]), 3);
      return { attrs: a };
    }
    case "rect":
      a.x = X(n("x"));
      a.y = Y(n("y"));
      a.width = fmt(n("width") * Math.abs(sx), 3);
      a.height = fmt(n("height") * Math.abs(sy), 3);
      return { attrs: a };
    case "ellipse":
      a.cx = X(n("cx"));
      a.cy = Y(n("cy"));
      a.rx = fmt(n("rx") * Math.abs(sx), 3);
      a.ry = fmt(n("ry") * Math.abs(sy), 3);
      return { attrs: a };
    case "circle": {
      if (Math.abs(sx - sy) < 1e-9) {
        a.cx = X(n("cx"));
        a.cy = Y(n("cy"));
        a.r = fmt(n("r") * Math.abs(sx), 3);
        return { attrs: a };
      }
      const r = n("r");
      delete a.r;
      a.cx = X(n("cx"));
      a.cy = Y(n("cy"));
      a.rx = fmt(r * Math.abs(sx), 3);
      a.ry = fmt(r * Math.abs(sy), 3);
      return { tag: "ellipse", attrs: a };
    }
    case "line":
      a.x1 = X(n("x1"));
      a.y1 = Y(n("y1"));
      a.x2 = X(n("x2"));
      a.y2 = Y(n("y2"));
      return { attrs: a };
    case "polyline":
    case "polygon": {
      const pts = parsePoints(a.points).map((p) => ({ x: p.x * sx + tx, y: p.y * sy + ty }));
      const params = shapeParams(node);
      if (params && (params.kind === "polygon" || params.kind === "star")) {
        const old = pathBounds(elementPath(node) ?? []);
        if (old) {
          const box = { x: old.x * sx + tx, y: old.y * sy + ty, width: old.width * Math.abs(sx), height: old.height * Math.abs(sy) };
          return { attrs: regenerateShapeAttrs(node, {}, box) ?? a };
        }
      }
      a.points = pointsAttr(pts);
      return { attrs: a };
    }
    default:
      return null;
  }
}

interface Snapshot {
  id: NodeId;
  tag?: string;
  attrs: Record<string, string>;
}

/** Shape elements of an SVG, or null when it contains anything we cannot rewrite exactly (text, transforms, ...). */
function rewritableElements(doc: FoldDocument, svg: OFNode): Snapshot[] | null {
  const out: Snapshot[] = [];
  let ok = true;
  const visit = (id: NodeId) => {
    const n = doc.nodes[id];
    if (!n || !ok) return;
    if (n.type === "SVGElement") {
      if (n.attrs?.transform) {
        ok = false;
        return;
      }
      if (n.tag === "g") {
        // groups are fine without transforms
      } else if (SHAPE_TAGS.has(n.tag ?? "")) {
        out.push({ id: n.id, tag: n.tag, attrs: { ...(n.attrs ?? {}) } });
      } else if (n.tag === "title" || n.tag === "desc") {
        // harmless
      } else {
        ok = false;
        return;
      }
    }
    for (const c of n.children) visit(c);
  };
  for (const c of svg.children) visit(c);
  return ok && out.length ? out : null;
}

/** Is this SVG fitted (viewBox origin 0 0 and the same size as its box)? */
export function isFittedSvg(svg: OFNode): boolean {
  if (svg.type !== "SVG") return false;
  const vb = parseViewBox(svg.attrs?.viewBox);
  const w = stylePx(svg.styles.width);
  const h = stylePx(svg.styles.height);
  if (!vb || w === undefined || h === undefined) return false;
  return Math.abs(vb.x) < 1e-6 && Math.abs(vb.y) < 1e-6 && Math.abs(vb.width - w) < 0.5 && Math.abs(vb.height - h) < 0.5;
}

/**
 * For a fitted SVG made of plain shapes: a function that rewrites its geometry for a new size, so resizing
 * scales the shapes (and regenerates polygons and stars) instead of letterboxing. Null otherwise.
 */
export function prepareVectorResize(doc: FoldDocument, id: NodeId): ((tx: Tx, width: number, height: number) => void) | null {
  const svg = doc.nodes[id];
  if (!svg || !isFittedSvg(svg)) return null;
  const vb = parseViewBox(svg.attrs?.viewBox)!;
  const snaps = rewritableElements(doc, svg);
  if (!snaps) return null;
  const baseAttrs = { ...(svg.attrs ?? {}) };
  return (tx, width, height) => {
    const sx = vb.width > 0.02 ? width / vb.width : 1;
    const sy = vb.height > 0.02 ? height / vb.height : 1;
    for (const s of snaps) {
      if (!tx.doc.nodes[s.id]) continue;
      const r = transformShapeAttrs({ tag: s.tag, attrs: s.attrs }, sx, sy, 0, 0);
      if (r) tx.updateNode(s.id, r.tag ? { tag: r.tag, attrs: r.attrs } : { attrs: r.attrs });
    }
    tx.updateNode(id, { attrs: { ...baseAttrs, viewBox: `0 0 ${fmt(Math.max(width, 0.01), 3)} ${fmt(Math.max(height, 0.01), 3)}` } });
  };
}

/**
 * Shrink or grow a positioned, fitted-style SVG to the bounds of its geometry, keeping every shape where it
 * is on the canvas. Used after path edits. Returns true when something changed.
 */
export function refitSvg(tx: Tx, svgId: NodeId): boolean {
  const svg = tx.doc.nodes[svgId];
  if (!svg || svg.type !== "SVG") return false;
  const vb = parseViewBox(svg.attrs?.viewBox);
  const w = stylePx(svg.styles.width);
  const h = stylePx(svg.styles.height);
  const left = stylePx(svg.styles.left);
  const top = stylePx(svg.styles.top);
  if (!vb || w === undefined || h === undefined || left === undefined || top === undefined) return false;
  const par = svg.attrs?.preserveAspectRatio ?? "";
  const sx = w / vb.width;
  const sy = h / vb.height;
  if (!par.startsWith("none") && Math.abs(sx - sy) > 1e-3) return false;
  const snaps = rewritableElements(tx.doc, svg);
  if (!snaps) return false;
  const raw = unionBounds(snaps.map((s) => pathBounds(elementPath({ tag: s.tag, attrs: s.attrs }) ?? [])));
  if (!raw) return false;
  // keep the padding axis centred on thin geometry
  const b = padBounds(raw, 1 / Math.max(sx, sy, 1e-6));
  if (Math.abs(b.x - vb.x) < 1e-3 && Math.abs(b.y - vb.y) < 1e-3 && Math.abs(b.width - vb.width) < 1e-3 && Math.abs(b.height - vb.height) < 1e-3) return false;
  for (const s of snaps) {
    const r = transformShapeAttrs({ tag: s.tag, attrs: s.attrs }, 1, 1, -b.x, -b.y);
    if (r) tx.updateNode(s.id, r.tag ? { tag: r.tag, attrs: r.attrs } : { attrs: r.attrs });
  }
  tx.updateNode(svgId, { attrs: { ...(svg.attrs ?? {}), viewBox: `0 0 ${fmt(b.width, 3)} ${fmt(b.height, 3)}` } });
  tx.setStyles(svgId, {
    width: Number(fmt(b.width * sx, 3)),
    height: Number(fmt(b.height * sy, 3)),
    left: Number(fmt(left + (b.x - vb.x) * sx, 3)),
    top: Number(fmt(top + (b.y - vb.y) * sy, 3)),
  });
  return true;
}

/** Path elements that path edit mode can work on. */
export function editablePathOf(doc: FoldDocument, id: NodeId): OFNode | undefined {
  const n = doc.nodes[id];
  if (!n) return undefined;
  if (n.type === "SVGElement" && SHAPE_TAGS.has(n.tag ?? "")) return n;
  if (n.type === "SVG") {
    const shapes: OFNode[] = [];
    const visit = (nid: NodeId) => {
      const c = doc.nodes[nid];
      if (!c) return;
      if (c.type === "SVGElement" && SHAPE_TAGS.has(c.tag ?? "")) shapes.push(c);
      else if (c.type === "SVGElement" && c.tag === "g") c.children.forEach(visit);
    };
    n.children.forEach(visit);
    return shapes.length === 1 ? shapes[0] : undefined;
  }
  return undefined;
}

/** Attributes that only describe a primitive's geometry (dropped when it becomes a path). */
const GEOMETRY_ATTRS = ["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points", "data-shape", "data-sides", "data-points", "data-ratio", "pathLength"];

/** Attributes for a path replacing a primitive shape element. */
export function pathAttrsFor(node: Pick<OFNode, "tag" | "attrs">, path: PathModel): Record<string, string> {
  const attrs: Record<string, string> = { d: serializePath(path, 3) };
  for (const [k, v] of Object.entries(node.attrs ?? {})) if (!GEOMETRY_ATTRS.includes(k) && k !== "d") attrs[k] = v;
  if (node.tag === "line" || node.tag === "polyline") attrs.fill ??= "none";
  return attrs;
}
