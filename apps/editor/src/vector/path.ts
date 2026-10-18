// Editable path model: SVG `d` strings parsed into subpaths of anchors with absolute bézier handles.
// Pure maths, no DOM. Used by the pen tool, path edit mode, shapes and boolean operations.

export interface Pt {
  x: number;
  y: number;
}

/** An anchor point. `in` and `out` are absolute control points, null for a straight side. */
export interface Anchor {
  x: number;
  y: number;
  in: Pt | null;
  out: Pt | null;
}

export interface Subpath {
  anchors: Anchor[];
  closed: boolean;
}

export type PathModel = Subpath[];

export type PointType = "corner" | "mirrored" | "asymmetric" | "disconnected";

export const POINT_TYPES: PointType[] = ["corner", "mirrored", "asymmetric", "disconnected"];

/** 2D affine matrix [a, b, c, d, e, f] like SVG: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const EPS = 1e-9;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ------------------------------------------------------------------ small vector helpers

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function norm(a: Pt): Pt {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

function same(a: Pt, b: Pt, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

export function clonePath(p: PathModel): PathModel {
  return p.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({ x: a.x, y: a.y, in: a.in ? { ...a.in } : null, out: a.out ? { ...a.out } : null })),
  }));
}

// ------------------------------------------------------------------ parsing

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Token = string | number;

/**
 * Split path data into commands and numbers. Arc flags are single characters and may be written
 * without separators ("a1 1 0 011 1"), so they are read one digit at a time.
 */
function tokenize(d: string): Token[] {
  const out: Token[] = [];
  const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  let i = 0;
  let cmd = "";
  let argIndex = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      out.push(ch);
      cmd = ch.toUpperCase();
      argIndex = 0;
      i++;
      continue;
    }
    const slot = cmd === "A" ? argIndex % 7 : -1;
    if ((slot === 3 || slot === 4) && (ch === "0" || ch === "1")) {
      out.push(Number(ch));
      argIndex++;
      i++;
      continue;
    }
    const m = num.exec(d.slice(i));
    if (!m) break;
    out.push(Number(m[0]));
    argIndex++;
    i += m[0].length;
  }
  return out;
}

/** Cubic segments approximating an SVG elliptical arc (endpoint parameterisation). */
export function arcToCubics(p0: Pt, rx: number, ry: number, angleDeg: number, largeArc: boolean, sweep: boolean, p: Pt): Array<[Pt, Pt, Pt]> {
  if (same(p0, p)) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < EPS || ry < EPS) return [[p0, p, p]];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p.x) / 2;
  const dy = (p0.y - p.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-7));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): Pt => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const deriv = (t: number): Pt => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const out: Array<[Pt, Pt, Pt]> = [];
  let t = theta1;
  let start = p0;
  for (let i = 0; i < segments; i++) {
    const t2 = t + step;
    const end = i === segments - 1 ? p : point(t2);
    const d1 = deriv(t);
    const d2 = deriv(t2);
    out.push([add(start, scale(d1, k)), sub(end, scale(d2, k)), end]);
    start = end;
    t = t2;
  }
  return out;
}

function cleanHandle(h: Pt | null, a: Pt): Pt | null {
  return h && !same(h, a, 1e-9) ? h : null;
}

/** Parse SVG path data into the editable model. Unknown or broken input yields the subpaths read so far. */
export function parsePath(d: string): PathModel {
  const tokens = tokenize(d ?? "");
  const path: PathModel = [];
  let cur: Subpath | null = null;
  let pos: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastCubic: Pt | null = null; // reflected for S
  let lastQuad: Pt | null = null; // reflected for T
  let i = 0;
  let cmd = "";

  const ensure = (): Subpath => {
    if (!cur) {
      cur = { anchors: [{ x: pos.x, y: pos.y, in: null, out: null }], closed: false };
      path.push(cur);
    }
    return cur;
  };
  const lineTo = (p: Pt) => {
    const s = ensure();
    s.anchors.push({ x: p.x, y: p.y, in: null, out: null });
    pos = p;
  };
  const cubicTo = (c1: Pt, c2: Pt, p: Pt) => {
    const s = ensure();
    const prev = s.anchors[s.anchors.length - 1];
    prev.out = cleanHandle(c1, prev);
    s.anchors.push({ x: p.x, y: p.y, in: cleanHandle(c2, p), out: null });
    pos = p;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        if (cur) {
          const s: Subpath = cur;
          // a closing segment that ends on the start point merges into the first anchor
          if (s.anchors.length > 1) {
            const first = s.anchors[0];
            const last = s.anchors[s.anchors.length - 1];
            if (same(first, last, 1e-6)) {
              first.in = last.in;
              s.anchors.pop();
            }
          }
          s.closed = true;
        }
        pos = start;
        cur = null;
        lastCubic = lastQuad = null;
        continue;
      }
    } else if (!cmd || cmd === "Z" || cmd === "z") {
      // numbers without a command: invalid, stop
      break;
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARG_COUNT[upper];
    let args: number[];
    args = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i + k];
      if (typeof v !== "number") break;
      args.push(v);
    }
    if (args.length !== n) break;
    i += n;
    const ox = rel ? pos.x : 0;
    const oy = rel ? pos.y : 0;
    switch (upper) {
      case "M": {
        const p = { x: args[0] + ox, y: args[1] + oy };
        cur = { anchors: [{ x: p.x, y: p.y, in: null, out: null }], closed: false };
        path.push(cur);
        pos = start = p;
        lastCubic = lastQuad = null;
        // subsequent pairs are implicit line-tos
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        lineTo({ x: args[0] + ox, y: args[1] + oy });
        lastCubic = lastQuad = null;
        break;
      case "H":
        lineTo({ x: args[0] + ox, y: pos.y });
        lastCubic = lastQuad = null;
        break;
      case "V":
        lineTo({ x: pos.x, y: args[0] + (rel ? pos.y : 0) });
        lastCubic = lastQuad = null;
        break;
      case "C": {
        const c1 = { x: args[0] + ox, y: args[1] + oy };
        const c2 = { x: args[2] + ox, y: args[3] + oy };
        cubicTo(c1, c2, { x: args[4] + ox, y: args[5] + oy });
        lastCubic = c2;
        lastQuad = null;
        break;
      }
      case "S": {
        const c1 = lastCubic ? { x: 2 * pos.x - lastCubic.x, y: 2 * pos.y - lastCubic.y } : { ...pos };
        const c2 = { x: args[0] + ox, y: args[1] + oy };
        cubicTo(c1, c2, { x: args[2] + ox, y: args[3] + oy });
        lastCubic = c2;
        lastQuad = null;
        break;
      }
      case "Q":
      case "T": {
        const q: Pt = upper === "Q" ? { x: args[0] + ox, y: args[1] + oy } : lastQuad ? { x: 2 * pos.x - lastQuad.x, y: 2 * pos.y - lastQuad.y } : { ...pos };
        const p = upper === "Q" ? { x: args[2] + ox, y: args[3] + oy } : { x: args[0] + ox, y: args[1] + oy };
        const p0 = pos;
        cubicTo(lerp(p0, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastQuad = q;
        lastCubic = null;
        break;
      }
      case "A": {
        const p = { x: args[5] + ox, y: args[6] + oy };
        const cubics = arcToCubics(pos, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, p);
        if (cubics.length === 0) lineTo(p);
        for (const [c1, c2, e] of cubics) {
          if (same(c1, pos) && same(c2, e)) lineTo(e);
          else cubicTo(c1, c2, e);
        }
        lastCubic = lastQuad = null;
        break;
      }
    }
  }
  return path.filter((s) => s.anchors.length > 0);
}

// ------------------------------------------------------------------ serialising

/** Compact number: up to `digits` decimals, no trailing zeros, no "-0". */
export function fmt(n: number, digits = 3): string {
  const k = 10 ** digits;
  const r = Math.round(n * k) / k;
  if (Object.is(r, -0) || r === 0) return "0";
  return String(r);
}

function isLine(a: Anchor, b: Anchor): boolean {
  return !a.out && !b.in;
}

/** Serialise the model as absolute path data (M, L, C, Z). */
export function serializePath(path: PathModel, digits = 3): string {
  const f = (n: number) => fmt(n, digits);
  const pt = (p: Pt) => `${f(p.x)} ${f(p.y)}`;
  const parts: string[] = [];
  for (const s of path) {
    if (s.anchors.length === 0) continue;
    parts.push(`M${pt(s.anchors[0])}`);
    const segment = (a: Anchor, b: Anchor) => {
      if (isLine(a, b)) parts.push(`L${pt(b)}`);
      else parts.push(`C${pt(a.out ?? a)} ${pt(b.in ?? b)} ${pt(b)}`);
    };
    for (let i = 1; i < s.anchors.length; i++) segment(s.anchors[i - 1], s.anchors[i]);
    if (s.closed) {
      const last = s.anchors[s.anchors.length - 1];
      const first = s.anchors[0];
      if (s.anchors.length > 1 && !isLine(last, first)) segment(last, first);
      parts.push("Z");
    }
  }
  return parts.join("");
}

// ------------------------------------------------------------------ segments, bounds, transforms

export interface Segment {
  sub: number;
  /** index of the start anchor; the segment runs to the next anchor (wrapping when closed) */
  index: number;
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
  line: boolean;
}

export function segmentCount(s: Subpath): number {
  const n = s.anchors.length;
  if (n < 2) return 0;
  return s.closed ? n : n - 1;
}

export function segmentAt(path: PathModel, subIndex: number, index: number): Segment {
  const s = path[subIndex];
  const a = s.anchors[index];
  const b = s.anchors[(index + 1) % s.anchors.length];
  return { sub: subIndex, index, p0: { x: a.x, y: a.y }, c1: a.out ?? { x: a.x, y: a.y }, c2: b.in ?? { x: b.x, y: b.y }, p1: { x: b.x, y: b.y }, line: isLine(a, b) };
}

export function segments(path: PathModel): Segment[] {
  const out: Segment[] = [];
  path.forEach((s, si) => {
    for (let i = 0; i < segmentCount(s); i++) out.push(segmentAt(path, si, i));
  });
  return out;
}

export function cubicPoint(s: Pick<Segment, "p0" | "c1" | "c2" | "p1">, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return { x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x, y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y };
}

/** Parameter values in (0,1) where the cubic's derivative is zero along one axis. */
function extrema(p0: number, c1: number, c2: number, p1: number): number[] {
  const a = -p0 + 3 * c1 - 3 * c2 + p1;
  const b = 2 * (p0 - 2 * c1 + c2);
  const c = c1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Exact geometric bounds (handles excluded), or null for an empty path. */
export function pathBounds(path: PathModel): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (p: Pt) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const s of path) for (const a of s.anchors) include(a);
  for (const seg of segments(path)) {
    if (seg.line) continue;
    for (const t of [...extrema(seg.p0.x, seg.c1.x, seg.c2.x, seg.p1.x), ...extrema(seg.p0.y, seg.c1.y, seg.c2.y, seg.p1.y)]) {
      include(cubicPoint(seg, t));
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBounds(list: Array<Bounds | null>): Bounds | null {
  const rs = list.filter((b): b is Bounds => !!b);
  if (rs.length === 0) return null;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function transformPath(path: PathModel, m: Matrix): PathModel {
  const f = (p: Pt) => applyMatrix(m, p);
  return path.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({ ...f(a), in: a.in ? f(a.in) : null, out: a.out ? f(a.out) : null })),
  }));
}

export function translatePath(path: PathModel, dx: number, dy: number): PathModel {
  return transformPath(path, [1, 0, 0, 1, dx, dy]);
}

/** Total number of anchors. */
export function anchorCount(path: PathModel): number {
  return path.reduce((n, s) => n + s.anchors.length, 0);
}

// ------------------------------------------------------------------ point types

/** Handles that matter for an anchor: open paths have no `in` at the start and no `out` at the end. */
function relevant(s: Subpath, i: number): { hasIn: boolean; hasOut: boolean } {
  if (s.closed) return { hasIn: true, hasOut: true };
  return { hasIn: i > 0, hasOut: i < s.anchors.length - 1 };
}

export function inferPointType(s: Subpath, i: number): PointType {
  const a = s.anchors[i];
  const r = relevant(s, i);
  const hin = r.hasIn ? a.in : null;
  const hout = r.hasOut ? a.out : null;
  if (!hin && !hout) return "corner";
  if (!hin || !hout) return r.hasIn && r.hasOut ? "disconnected" : "mirrored";
  const v1 = sub(hin, a);
  const v2 = sub(hout, a);
  const l1 = len(v1);
  const l2 = len(v2);
  const cross = v1.x * v2.y - v1.y * v2.x;
  const dot = v1.x * v2.x + v1.y * v2.y;
  const collinear = Math.abs(cross) <= 1e-3 * l1 * l2 + 1e-9 && dot < 0;
  if (!collinear) return "disconnected";
  return Math.abs(l1 - l2) <= 1e-3 * Math.max(l1, l2) + 1e-6 ? "mirrored" : "asymmetric";
}

function neighbours(s: Subpath, i: number): { prev: Anchor | null; next: Anchor | null } {
  const n = s.anchors.length;
  const prev = i > 0 ? s.anchors[i - 1] : s.closed && n > 1 ? s.anchors[n - 1] : null;
  const next = i < n - 1 ? s.anchors[i + 1] : s.closed && n > 1 ? s.anchors[0] : null;
  return { prev, next };
}

/**
 * Change an anchor's type in place. Smooth types reuse existing handles when there are any,
 * otherwise handles are derived from the neighbours (a third of each side, along prev → next).
 */
export function setPointType(s: Subpath, i: number, type: PointType): void {
  const a = s.anchors[i];
  if (type === "corner") {
    a.in = null;
    a.out = null;
    return;
  }
  const { prev, next } = neighbours(s, i);
  const hasHandles = !!(a.in || a.out);
  let dir: Pt;
  let lin: number;
  let lout: number;
  if (hasHandles) {
    const vin = a.in ? sub(a, a.in) : null; // pointing forward
    const vout = a.out ? sub(a.out, a) : null;
    dir = norm(vin && vout ? add(norm(vin), norm(vout)) : (vout ?? vin)!);
    if (len(dir) < EPS) dir = norm(vout ?? vin ?? { x: 1, y: 0 });
    lin = a.in ? dist(a, a.in) : a.out ? dist(a, a.out) : 0;
    lout = a.out ? dist(a, a.out) : lin;
    if (!a.in) lin = lout;
  } else {
    const p = prev ?? a;
    const q = next ?? a;
    dir = norm(sub(q, p));
    if (len(dir) < EPS) dir = { x: 1, y: 0 };
    lin = prev ? dist(prev, a) / 3 : dist(a, q) / 3;
    lout = next ? dist(a, next) / 3 : lin;
  }
  if (type === "disconnected" && hasHandles) {
    // keep handles as they are, fill in a missing one
    if (!a.in) a.in = sub(a, scale(dir, lin));
    if (!a.out) a.out = add(a, scale(dir, lout));
    return;
  }
  if (type === "mirrored") {
    const l = (lin + lout) / 2;
    lin = lout = l;
  }
  a.in = sub(a, scale(dir, lin));
  a.out = add(a, scale(dir, lout));
}

/** Move one handle and keep the anchor's type: mirrored mirrors, asymmetric keeps the other length. */
export function moveHandle(s: Subpath, i: number, side: "in" | "out", pos: Pt, type: PointType): void {
  const a = s.anchors[i];
  a[side] = same(pos, a, 1e-9) ? null : { x: pos.x, y: pos.y };
  const other = side === "in" ? "out" : "in";
  if (type === "mirrored") {
    a[other] = a[side] ? { x: 2 * a.x - pos.x, y: 2 * a.y - pos.y } : null;
  } else if (type === "asymmetric") {
    const o = a[other];
    const l = o ? dist(o, a) : dist(pos, a);
    const d = norm(sub(a, pos));
    a[other] = a[side] && l > EPS ? add(a, scale(d, l)) : o;
  }
}

/** Translate an anchor together with its handles. */
export function moveAnchor(a: Anchor, dx: number, dy: number): void {
  a.x += dx;
  a.y += dy;
  if (a.in) a.in = { x: a.in.x + dx, y: a.in.y + dy };
  if (a.out) a.out = { x: a.out.x + dx, y: a.out.y + dy };
}

// ------------------------------------------------------------------ structural edits

export interface PointRef {
  sub: number;
  index: number;
}

export const refKey = (r: PointRef): string => `${r.sub}:${r.index}`;

export function parseRefKey(k: string): PointRef {
  const [s, i] = k.split(":").map(Number);
  return { sub: s, index: i };
}

/** Split a segment at t, inserting a new anchor. Returns the new anchor's ref. */
export function splitSegment(path: PathModel, subIndex: number, index: number, t: number): PointRef {
  const s = path[subIndex];
  const seg = segmentAt(path, subIndex, index);
  const a = s.anchors[index];
  const bIndex = (index + 1) % s.anchors.length;
  const b = s.anchors[bIndex];
  let anchor: Anchor;
  if (seg.line) {
    const p = lerp(seg.p0, seg.p1, t);
    anchor = { x: p.x, y: p.y, in: null, out: null };
  } else {
    const p01 = lerp(seg.p0, seg.c1, t);
    const p12 = lerp(seg.c1, seg.c2, t);
    const p23 = lerp(seg.c2, seg.p1, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const p = lerp(p012, p123, t);
    a.out = cleanHandle(p01, a);
    b.in = cleanHandle(p23, b);
    anchor = { x: p.x, y: p.y, in: cleanHandle(p012, p), out: cleanHandle(p123, p) };
  }
  s.anchors.splice(index + 1, 0, anchor);
  return { sub: subIndex, index: index + 1 };
}

/** Remove anchors. Subpaths left with fewer than two anchors disappear. */
export function deleteAnchors(path: PathModel, refs: PointRef[]): PathModel {
  const kill = new Set(refs.map(refKey));
  const out: PathModel = [];
  path.forEach((s, si) => {
    const anchors = s.anchors.filter((_, i) => !kill.has(refKey({ sub: si, index: i })));
    if (anchors.length >= 2) out.push({ anchors, closed: s.closed && anchors.length >= 2 });
  });
  return out;
}

/** Nearest point on a segment to `p`: parameter t and distance. */
export function nearestOnSegment(seg: Segment, p: Pt): { t: number; d: number; point: Pt } {
  if (seg.line) {
    const v = sub(seg.p1, seg.p0);
    const l2 = v.x * v.x + v.y * v.y;
    const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - seg.p0.x) * v.x + (p.y - seg.p0.y) * v.y) / l2));
    const q = lerp(seg.p0, seg.p1, t);
    return { t, d: dist(p, q), point: q };
  }
  const N = 48;
  let bestT = 0;
  let best = Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = dist(cubicPoint(seg, t), p);
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  // refine by bisection around the best sample
  let lo = Math.max(0, bestT - 1 / N);
  let hi = Math.min(1, bestT + 1 / N);
  for (let k = 0; k < 30; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(cubicPoint(seg, m1), p) < dist(cubicPoint(seg, m2), p)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const q = cubicPoint(seg, t);
  return { t, d: dist(q, p), point: q };
}

/** Nearest segment of a whole path to `p`. */
export function nearestSegment(path: PathModel, p: Pt): { seg: Segment; t: number; d: number; point: Pt } | null {
  let best: { seg: Segment; t: number; d: number; point: Pt } | null = null;
  for (const seg of segments(path)) {
    const r = nearestOnSegment(seg, p);
    if (!best || r.d < best.d) best = { seg, ...r };
  }
  return best;
}

/**
 * Bend a segment so the point at parameter t moves by `delta`, by moving both control points
 * (least-squares split by their Bernstein weights). Straight segments get handles first.
 */
export function bendSegment(path: PathModel, subIndex: number, index: number, t: number, delta: Pt): void {
  const s = path[subIndex];
  const a = s.anchors[index];
  const b = s.anchors[(index + 1) % s.anchors.length];
  const c1 = a.out ?? lerp(a, b, 1 / 3);
  const c2 = b.in ?? lerp(a, b, 2 / 3);
  const tt = Math.max(0.05, Math.min(0.95, t));
  const w1 = 3 * (1 - tt) * (1 - tt) * tt;
  const w2 = 3 * (1 - tt) * tt * tt;
  const k = 1 / (w1 * w1 + w2 * w2);
  a.out = add(c1, scale(delta, w1 * k));
  b.in = add(c2, scale(delta, w2 * k));
}

/** Keep smooth anchors smooth after one of their handles moved (used after bending). */
export function enforceType(s: Subpath, i: number, changed: "in" | "out", type: PointType): void {
  const a = s.anchors[i];
  const h = a[changed];
  if (!h) return;
  if (type === "mirrored" || type === "asymmetric") moveHandle(s, i, changed, h, type);
}
