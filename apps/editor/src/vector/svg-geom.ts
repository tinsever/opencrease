// Geometry of SVG nodes in the document model: element → path, transforms, viewBox mapping.
// Pure functions over a FoldDocument, so the canvas, the inspector and agent tools share them.
import type { FoldDocument, NodeId, OFNode } from "@opencrease/model";
import { IDENTITY, multiply, parsePath, type Anchor, type Matrix, type PathModel, type Pt } from "./path";

/** Elements that paint geometry we can turn into paths. */
export const SHAPE_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

/** Bézier circle constant. */
const K = 0.5522847498;

export function attrNum(node: Pick<OFNode, "attrs">, key: string, fallback = 0): number {
  const v = node.attrs?.[key];
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePoints(s: string | undefined): Pt[] {
  const nums = (s ?? "").match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

const corner = (x: number, y: number): Anchor => ({ x, y, in: null, out: null });

export function rectPath(x: number, y: number, w: number, h: number, rx = 0, ry = rx): PathModel {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  if (rx === 0 || ry === 0) {
    return [{ closed: true, anchors: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] }];
  }
  const kx = rx * K;
  const ky = ry * K;
  const r = x + w;
  const b = y + h;
  const anchors: Anchor[] = [
    { x: x + rx, y, in: { x: x + rx - kx, y }, out: null },
    { x: r - rx, y, in: null, out: { x: r - rx + kx, y } },
    { x: r, y: y + ry, in: { x: r, y: y + ry - ky }, out: null },
    { x: r, y: b - ry, in: null, out: { x: r, y: b - ry + ky } },
    { x: r - rx, y: b, in: { x: r - rx + kx, y: b }, out: null },
    { x: x + rx, y: b, in: null, out: { x: x + rx - kx, y: b } },
    { x, y: b - ry, in: { x, y: b - ry + ky }, out: null },
    { x, y: y + ry, in: null, out: { x, y: y + ry - ky } },
  ];
  // drop duplicate anchors where straight sides have zero length
  const merged: Anchor[] = [];
  for (const a of anchors) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.x - a.x) < 1e-9 && Math.abs(prev.y - a.y) < 1e-9) {
      prev.out = a.out;
    } else merged.push(a);
  }
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (merged.length > 1 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
    first.in = last.in;
    merged.pop();
  }
  return [{ closed: true, anchors: merged }];
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathModel {
  const kx = rx * K;
  const ky = ry * K;
  return [
    {
      closed: true,
      anchors: [
        { x: cx, y: cy - ry, in: { x: cx - kx, y: cy - ry }, out: { x: cx + kx, y: cy - ry } },
        { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ky }, out: { x: cx + rx, y: cy + ky } },
        { x: cx, y: cy + ry, in: { x: cx + kx, y: cy + ry }, out: { x: cx - kx, y: cy + ry } },
        { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ky }, out: { x: cx - rx, y: cy - ky } },
      ],
    },
  ];
}

export function polyPath(points: Pt[], closed: boolean): PathModel {
  if (points.length === 0) return [];
  return [{ closed, anchors: points.map((p) => corner(p.x, p.y)) }];
}

/** Geometry of one SVG element in its own user space, or null for non-geometric elements. */
export function elementPath(node: Pick<OFNode, "tag" | "attrs">): PathModel | null {
  const n = (k: string, f = 0) => attrNum(node, k, f);
  switch (node.tag) {
    case "path":
      return parsePath(node.attrs?.d ?? "");
    case "rect": {
      const rxAttr = node.attrs?.rx;
      const ryAttr = node.attrs?.ry;
      const rx = rxAttr !== undefined ? n("rx") : ryAttr !== undefined ? n("ry") : 0;
      const ry = ryAttr !== undefined ? n("ry") : rx;
      return rectPath(n("x"), n("y"), n("width"), n("height"), rx, ry);
    }
    case "circle":
      return ellipsePath(n("cx"), n("cy"), n("r"), n("r"));
    case "ellipse":
      return ellipsePath(n("cx"), n("cy"), n("rx"), n("ry"));
    case "line":
      return polyPath([{ x: n("x1"), y: n("y1") }, { x: n("x2"), y: n("y2") }], false);
    case "polyline":
      return polyPath(parsePoints(node.attrs?.points), false);
    case "polygon":
      return polyPath(parsePoints(node.attrs?.points), true);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ transforms

/** Parse an SVG `transform` attribute. */
export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = [...IDENTITY];
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    const a = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    let t: Matrix = [...IDENTITY];
    switch (match[1]) {
      case "matrix":
        if (a.length === 6) t = a as Matrix;
        break;
      case "translate":
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (a.length >= 3) t = multiply(multiply([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]);
        else t = rot;
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseViewBox(s: string | undefined): ViewBox | null {
  const n = (s ?? "").trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;
  return { x: n[0], y: n[1], width: n[2], height: n[3] };
}

/** Map from an svg's user space (viewBox) to its CSS box of `width` × `height` px. */
export function viewBoxMatrix(attrs: Record<string, string> | undefined, width: number, height: number): Matrix {
  const vb = parseViewBox(attrs?.viewBox);
  if (!vb || width <= 0 || height <= 0) return [...IDENTITY];
  const par = (attrs?.preserveAspectRatio ?? "xMidYMid meet").trim();
  let sx = width / vb.width;
  let sy = height / vb.height;
  let tx = 0;
  let ty = 0;
  if (!par.startsWith("none")) {
    const [align, mode] = par.split(/\s+/);
    const s = mode === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
    const fx = /xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0;
    const fy = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
    tx = (width - vb.width * s) * fx;
    ty = (height - vb.height * s) * fy;
  }
  return [sx, 0, 0, sy, tx - vb.x * sx, ty - vb.y * sy];
}

/** The SVG node that owns `id` (itself when it is an SVG node). */
export function ownerSvg(doc: FoldDocument, id: NodeId): OFNode | undefined {
  let cur: OFNode | undefined = doc.nodes[id];
  while (cur && cur.type === "SVGElement") cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  return cur?.type === "SVG" ? cur : undefined;
}

/** px number from a style value. */
export function stylePx(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Matrix from an element's user space to its owning svg's CSS box (px, origin at the box's top left).
 * `size` is the svg's rendered size; it defaults to its width/height styles.
 */
export function elementToSvgBox(doc: FoldDocument, id: NodeId, size?: { width: number; height: number }): Matrix {
  const svg = ownerSvg(doc, id);
  if (!svg) return [...IDENTITY];
  const w = size?.width ?? stylePx(svg.styles.width) ?? attrNum(svg, "width", 0);
  const h = size?.height ?? stylePx(svg.styles.height) ?? attrNum(svg, "height", 0);
  let m = viewBoxMatrix(svg.attrs, w, h);
  const chain: OFNode[] = [];
  let cur: OFNode | undefined = doc.nodes[id];
  while (cur && cur.type === "SVGElement") {
    chain.unshift(cur);
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  for (const n of chain) m = multiply(m, parseTransform(n.attrs?.transform));
  return m;
}

/** Drawable SVG elements under (and including) `id`, in paint order. */
export function shapeElements(doc: FoldDocument, id: NodeId): OFNode[] {
  const out: OFNode[] = [];
  const visit = (nid: NodeId) => {
    const n = doc.nodes[nid];
    if (!n || !n.visible) return;
    if (n.type === "SVGElement" && (n.tag === "defs" || n.tag === "clipPath" || n.tag === "mask" || n.tag === "symbol" || n.tag === "pattern" || /Gradient$/.test(n.tag ?? ""))) return;
    if (n.type === "SVGElement" && SHAPE_TAGS.has(n.tag ?? "")) out.push(n);
    for (const c of n.children) visit(c);
  };
  visit(id);
  return out;
}

// ------------------------------------------------------------------ paint

/** Effective presentation value of an element: style first, then attribute, then inherited from SVG ancestors. */
export function paintValue(doc: FoldDocument, node: OFNode, key: string, attr: string): string | undefined {
  let cur: OFNode | undefined = node;
  while (cur && (cur.type === "SVGElement" || cur.type === "SVG")) {
    const s = cur.styles[key];
    if (s !== undefined && s !== "") return String(s);
    const a = cur.attrs?.[attr];
    if (a !== undefined && a !== "") return a;
    if (cur.type === "SVG") break;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return undefined;
}

export interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  strokeMiterlimit?: number;
  fillRule?: string;
  fillOpacity?: string;
  strokeOpacity?: string;
  color?: string;
  opacity?: string;
}

export function paintOf(doc: FoldDocument, node: OFNode): Paint {
  let opacity = 1;
  for (let n: OFNode | undefined = node; n?.type === "SVGElement" || n?.type === "SVG"; n = n.parentId ? doc.nodes[n.parentId] : undefined) {
    const v = n.styles.opacity ?? n.attrs?.opacity;
    if (v !== undefined) opacity *= Math.max(0, Math.min(1, parseFloat(String(v))));
  }
  return {
    fill: paintValue(doc, node, "fill", "fill") ?? "#000000",
    stroke: paintValue(doc, node, "stroke", "stroke") ?? "none",
    strokeWidth: Math.max(0, parseFloat(paintValue(doc, node, "strokeWidth", "stroke-width") ?? "1")),
    strokeLinecap: paintValue(doc, node, "strokeLinecap", "stroke-linecap"),
    strokeLinejoin: paintValue(doc, node, "strokeLinejoin", "stroke-linejoin"),
    strokeDasharray: paintValue(doc, node, "strokeDasharray", "stroke-dasharray"),
    strokeDashoffset: parseFloat(paintValue(doc, node, "strokeDashoffset", "stroke-dashoffset") ?? "0"),
    strokeMiterlimit: parseFloat(paintValue(doc, node, "strokeMiterlimit", "stroke-miterlimit") ?? "4"),
    fillRule: paintValue(doc, node, "fillRule", "fill-rule"),
    fillOpacity: paintValue(doc, node, "fillOpacity", "fill-opacity"),
    strokeOpacity: paintValue(doc, node, "strokeOpacity", "stroke-opacity"),
    color: paintValue(doc, node, "color", "color"),
    opacity: opacity === 1 ? undefined : String(opacity),
  };
}

export function isPaintNone(v: string | undefined): boolean {
  return !v || v === "none" || v === "transparent";
}
