// CSS gradients: parse to structured values, serialise back, and the geometry the canvas handles use.
import { parseColor, splitCommas, splitSpaces } from "@opencrease/css";

export interface GradientStop {
  color: string;
  /** percent 0..100 (conic: of a full turn), undefined = auto */
  position?: number;
}

/** A position like `at 30% 40%`, in percent of the box. */
export interface Point2 {
  x: number;
  y: number;
}

export type Gradient =
  | { kind: "linear"; angle: number; stops: GradientStop[]; interpolation?: string; repeating?: boolean }
  | { kind: "radial"; shape?: "circle" | "ellipse"; radialSize?: string; at?: Point2; stops: GradientStop[]; interpolation?: string; repeating?: boolean }
  | { kind: "conic"; angle: number; at?: Point2; stops: GradientStop[]; interpolation?: string; repeating?: boolean };

export type GradientKind = Gradient["kind"];

const SIDE_ANGLES: Record<string, number> = {
  "to top": 0, "to top right": 45, "to right top": 45, "to right": 90, "to bottom right": 135, "to right bottom": 135,
  "to bottom": 180, "to bottom left": 225, "to left bottom": 225, "to left": 270, "to top left": 315, "to left top": 315,
};

const RADIAL_SIZES = new Set(["closest-side", "closest-corner", "farthest-side", "farthest-corner"]);

export function isColorValue(v: string): boolean {
  const t = v.trim();
  return !!parseColor(t) || /^var\(/.test(t) || /^color-mix\(/i.test(t) || /^light-dark\(/i.test(t) || t === "currentColor" || t === "currentcolor";
}

function funcParts(value: string): { name: string; inner: string } | null {
  const m = /^(-?[\w-]+)\(([\s\S]*)\)$/.exec(value.trim());
  return m ? { name: m[1].toLowerCase(), inner: m[2] } : null;
}

export function parseAngle(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t in SIDE_ANGLES) return SIDE_ANGLES[t];
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "turn": return n * 360;
    case "rad": return (n * 180) / Math.PI;
    case "grad": return n * 0.9;
    default: return m[2] || n === 0 ? n : null;
  }
}

const KEYWORD_POS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

/** `30% 40%`, `center`, `left top`, `right 20%` → percent point. Lengths other than % are not supported. */
export function parsePosition(text: string): Point2 | null {
  const parts = splitSpaces(text.trim().toLowerCase());
  if (parts.length === 0 || parts.length > 2) return null;
  const val = (t: string): number | null => {
    if (t in KEYWORD_POS) return KEYWORD_POS[t];
    const m = /^(-?\d*\.?\d+)%$/.exec(t);
    if (m) return Number(m[1]);
    return t === "0" ? 0 : null;
  };
  if (parts.length === 1) {
    const t = parts[0];
    if (t === "top" || t === "bottom") return { x: 50, y: KEYWORD_POS[t] };
    const v = val(t);
    return v === null ? null : { x: v, y: 50 };
  }
  let [a, b] = parts;
  // "top left" → x = left, y = top
  if ((a === "top" || a === "bottom") && (b === "left" || b === "right" || b === "center")) [a, b] = [b, a];
  const x = val(a);
  const y = val(b);
  return x === null || y === null ? null : { x, y };
}

const num = (n: number) => String(Math.round(n * 100) / 100);

export function positionToCss(p: Point2): string {
  return `${num(p.x)}% ${num(p.y)}%`;
}

/** Splits `in oklab` / `in oklch longer hue` out of the first gradient argument. */
function splitInterpolation(first: string): { interpolation?: string; rest: string } {
  const m = /^(.*?)\s*\b(in\s+[\w-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?)\s*(.*)$/i.exec(first.trim());
  if (!m) return { rest: first.trim() };
  return { interpolation: m[2], rest: `${m[1]} ${m[3]}`.trim() };
}

function parseStop(part: string, conic: boolean): GradientStop[] | null {
  const tokens = splitSpaces(part);
  let color: string | undefined;
  const positions: number[] = [];
  for (const t of tokens) {
    const pm = /^(-?\d*\.?\d+)%$/.exec(t);
    if (pm) {
      positions.push(Number(pm[1]));
      continue;
    }
    if (conic) {
      const a = /^-?\d*\.?\d+(deg|turn|rad|grad)$/.test(t) ? parseAngle(t) : null;
      if (a !== null) {
        positions.push(a / 3.6);
        continue;
      }
    }
    if (t === "0") positions.push(0);
    else if (!color && isColorValue(t)) color = t;
    else return null;
  }
  if (!color) return null;
  if (positions.length === 0) return [{ color }];
  return positions.map((position) => ({ color: color!, position }));
}

/** First argument of a radial gradient: shape, size, position. Null when it is not a valid head. */
function parseRadialHead(rest: string): { shape?: "circle" | "ellipse"; size?: string; at?: Point2 } | null {
  const out: { shape?: "circle" | "ellipse"; size?: string; at?: Point2 } = {};
  const lower = rest.trim().toLowerCase();
  if (!lower) return out;
  const atIdx = splitSpaces(lower).indexOf("at");
  const tokens = splitSpaces(lower);
  const head = atIdx >= 0 ? tokens.slice(0, atIdx) : tokens;
  if (atIdx >= 0) {
    const p = parsePosition(tokens.slice(atIdx + 1).join(" "));
    if (!p) return null;
    out.at = p;
  }
  const sizeParts: string[] = [];
  for (const t of head) {
    if (t === "circle" || t === "ellipse") out.shape = t;
    else if (RADIAL_SIZES.has(t) || /^-?\d*\.?\d+(px|%|em|rem)?$/.test(t)) sizeParts.push(t);
    else return null;
  }
  if (sizeParts.length) out.size = sizeParts.join(" ");
  return out;
}

function parseConicHead(rest: string): { angle: number; at?: Point2 } | null {
  const tokens = splitSpaces(rest.trim().toLowerCase());
  let angle = 0;
  let at: Point2 | undefined;
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === "from" && tokens[i + 1]) {
      const a = parseAngle(tokens[i + 1]);
      if (a === null) return null;
      angle = a;
      i += 2;
    } else if (tokens[i] === "at") {
      const stop = tokens.indexOf("from", i + 1);
      const posTokens = tokens.slice(i + 1, stop < 0 ? undefined : stop);
      const p = parsePosition(posTokens.join(" "));
      if (!p) return null;
      at = p;
      i += 1 + posTokens.length;
    } else return null;
  }
  return { angle, at };
}

const GRADIENT_FUNCS = new Set(["linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient"]);

/** Parses one CSS gradient image. Returns null for anything it cannot represent exactly. */
export function parseGradient(value: string): Gradient | null {
  const f = funcParts(value);
  if (!f || !GRADIENT_FUNCS.has(f.name)) return null;
  const repeating = f.name.startsWith("repeating-");
  const kind = f.name.replace("repeating-", "").replace("-gradient", "") as GradientKind;
  const args = splitCommas(f.inner);
  if (args.length === 0) return null;
  let interpolation: string | undefined;
  let start = 0;
  let head: { angle?: number; shape?: "circle" | "ellipse"; size?: string; at?: Point2 } = {};
  if (!parseStop(args[0], kind === "conic")) {
    const split = splitInterpolation(args[0]);
    interpolation = split.interpolation;
    if (kind === "linear") {
      if (split.rest) {
        const a = parseAngle(split.rest);
        if (a === null) return null;
        head.angle = a;
      }
    } else if (kind === "radial") {
      const h = parseRadialHead(split.rest);
      if (!h) return null;
      head = h;
    } else {
      const h = parseConicHead(split.rest);
      if (!h) return null;
      head = h;
    }
    start = 1;
  }
  const stops: GradientStop[] = [];
  for (const part of args.slice(start)) {
    if (/^-?\d*\.?\d+(%|deg)?$/.test(part.trim())) return null; // preserve hints as raw CSS
    const s = parseStop(part, kind === "conic");
    if (!s) return null;
    stops.push(...s);
  }
  if (stops.length < 2) return null;
  const extra = { ...(interpolation ? { interpolation } : {}), ...(repeating ? { repeating } : {}) };
  if (kind === "linear") return { kind, angle: head.angle ?? 180, stops, ...extra };
  if (kind === "conic") return { kind, angle: head.angle ?? 0, ...(head.at ? { at: head.at } : {}), stops, ...extra };
  return {
    kind,
    ...(head.shape ? { shape: head.shape } : {}),
    ...(head.size ? { radialSize: head.size } : {}),
    ...(head.at ? { at: head.at } : {}),
    stops,
    ...extra,
  };
}

function stopToCss(s: GradientStop, conic: boolean): string {
  if (s.position === undefined) return s.color;
  return conic ? `${s.color} ${num(s.position * 3.6)}deg` : `${s.color} ${num(s.position)}%`;
}

const isCenter = (p: Point2 | undefined) => !p || (Math.abs(p.x - 50) < 0.005 && Math.abs(p.y - 50) < 0.005);

export function gradientToCss(g: Gradient): string {
  const fn = `${g.repeating ? "repeating-" : ""}${g.kind}-gradient`;
  const parts: string[] = [];
  if (g.kind === "linear") {
    parts.push(`${num(g.angle)}deg`);
  } else if (g.kind === "radial") {
    if (g.shape) parts.push(g.shape);
    if (g.radialSize) parts.push(g.radialSize);
    if (!isCenter(g.at)) parts.push(`at ${positionToCss(g.at!)}`);
  } else {
    if (g.angle) parts.push(`from ${num(g.angle)}deg`);
    if (!isCenter(g.at)) parts.push(`at ${positionToCss(g.at!)}`);
  }
  if (g.interpolation) parts.push(g.interpolation);
  const head = parts.join(" ");
  const stops = g.stops.map((s) => stopToCss(s, g.kind === "conic")).join(", ");
  return `${fn}(${head ? `${head}, ` : ""}${stops})`;
}

/** Converts between kinds, keeping stops, interpolation and position where they apply. */
export function convertGradient(g: Gradient, kind: GradientKind): Gradient {
  if (g.kind === kind) return g;
  const base = { stops: g.stops, ...(g.repeating ? { repeating: true } : {}), ...(g.interpolation ? { interpolation: g.interpolation } : {}) };
  const at = g.kind === "linear" ? undefined : g.at;
  const angle = g.kind === "radial" ? (kind === "linear" ? 180 : 0) : g.angle;
  if (kind === "linear") return { kind, angle, ...base };
  if (kind === "conic") return { kind, angle, ...(at ? { at } : {}), ...base };
  return { kind, shape: "circle", ...(at ? { at } : {}), ...base };
}

/** Stops with every position resolved (auto stops spread evenly between their neighbours, CSS rules). */
export function resolvedStops(stops: GradientStop[]): Array<{ color: string; position: number }> {
  const n = stops.length;
  const pos: Array<number | undefined> = stops.map((s) => s.position);
  if (n === 0) return [];
  if (pos[0] === undefined) pos[0] = 0;
  if (pos[n - 1] === undefined) pos[n - 1] = n === 1 ? 0 : 100;
  // monotonic
  let max = pos[0]!;
  for (let i = 1; i < n; i++) {
    if (pos[i] !== undefined) {
      if (pos[i]! < max) pos[i] = max;
      max = pos[i]!;
    }
  }
  for (let i = 1; i < n; i++) {
    if (pos[i] !== undefined) continue;
    let j = i;
    while (pos[j] === undefined) j++;
    const a = pos[i - 1]!;
    const b = pos[j]!;
    for (let k = i; k < j; k++) pos[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return stops.map((s, i) => ({ color: s.color, position: pos[i]! }));
}

/** Inserts a stop at `position`, keeping stops sorted. Returns the new list and the index of the new stop. */
export function insertStop(stops: GradientStop[], color: string, position: number): { stops: GradientStop[]; index: number } {
  const resolved = resolvedStops(stops);
  const next: GradientStop[] = resolved.map((s) => ({ ...s }));
  let index = resolved.findIndex((s) => s.position > position);
  if (index < 0) index = next.length;
  next.splice(index, 0, { color, position: Math.round(position * 100) / 100 });
  return { stops: next, index };
}

/** Move a stop through its neighbours, keeping CSS stop order and returning its new index. */
export function moveStop(stops: GradientStop[], index: number, position: number): { stops: GradientStop[]; index: number } {
  const next = resolvedStops(stops).map((s, i) => ({ ...s, position: i === index ? position : s.position, original: i }));
  next.sort((a, b) => a.position - b.position);
  return { stops: next.map(({ original: _i, ...s }) => s), index: next.findIndex((s) => s.original === index) };
}

// ---------------------------------------------------------------- geometry (box-local px)

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The CSS gradient line of a linear gradient in a w × h box (start = 0%, end = 100%). */
export function linearLine(angleDeg: number, w: number, h: number): Line {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

/** Angle (deg, CSS convention: 0 = up, clockwise) of the vector from (cx, cy) to (x, y). */
export function angleFromPoints(cx: number, cy: number, x: number, y: number): number {
  const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Projects (x, y) onto a line, as a percentage along it (unclamped). */
export function projectOnLine(line: Line, x: number, y: number): number {
  const vx = line.x2 - line.x1;
  const vy = line.y2 - line.y1;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return 0;
  return (((x - line.x1) * vx + (y - line.y1) * vy) / len2) * 100;
}

/** Horizontal radius of the radial gradient's ending shape (only keyword sizes and px are resolved). */
export function radialRadius(g: Extract<Gradient, { kind: "radial" }>, w: number, h: number): { rx: number; ry: number } {
  const cx = ((g.at?.x ?? 50) / 100) * w;
  const cy = ((g.at?.y ?? 50) / 100) * h;
  const sides = { l: cx, r: w - cx, t: cy, b: h - cy };
  const closeX = Math.min(Math.abs(sides.l), Math.abs(sides.r));
  const closeY = Math.min(Math.abs(sides.t), Math.abs(sides.b));
  const farX = Math.max(Math.abs(sides.l), Math.abs(sides.r));
  const farY = Math.max(Math.abs(sides.t), Math.abs(sides.b));
  const size = (g.radialSize ?? "farthest-corner").trim();
  const circle = g.shape === "circle" || (!g.shape && /^\d*\.?\d+px$/.test(size));
  const px = /^(\d*\.?\d+)px(?:\s+(\d*\.?\d+)px)?$/.exec(size);
  if (px) {
    const rx = Number(px[1]);
    return { rx, ry: px[2] ? Number(px[2]) : rx };
  }
  switch (size) {
    case "closest-side":
      return circle ? { rx: Math.min(closeX, closeY), ry: Math.min(closeX, closeY) } : { rx: closeX, ry: closeY };
    case "farthest-side":
      return circle ? { rx: Math.max(farX, farY), ry: Math.max(farX, farY) } : { rx: farX, ry: farY };
    case "closest-corner": {
      const d = Math.hypot(closeX, closeY);
      return circle ? { rx: d, ry: d } : { rx: closeX * Math.SQRT2, ry: closeY * Math.SQRT2 };
    }
    default: {
      const d = Math.hypot(farX, farY);
      return circle ? { rx: d, ry: d } : { rx: farX * Math.SQRT2, ry: farY * Math.SQRT2 };
    }
  }
}
