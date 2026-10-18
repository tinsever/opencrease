// Pure math for rotated boxes: hit tests, handle positions, rotate gestures and resizing a rotated
// node in its own frame. Angles are degrees, clockwise (CSS `rotate`), around the box centre.
import { handleAxes, resizeRect, type Handle, type Point, type Rect, type ResizeOptions } from "./geometry";

export interface OrientedBox {
  /** centre, world units */
  cx: number;
  cy: number;
  /** unrotated size, world units */
  width: number;
  height: number;
  /** degrees, clockwise */
  angle: number;
}

const RAD = Math.PI / 180;

/** Parse a CSS angle (`15deg`, `0.25turn`, `1rad`, `100grad` or a number of degrees). */
export function parseAngle(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const m = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(deg|turn|rad|grad)?\s*$/i.exec(value);
  if (!m) return 0;
  const n = Number(m[1]);
  switch ((m[2] ?? "deg").toLowerCase()) {
    case "turn":
      return n * 360;
    case "rad":
      return n / RAD;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

/** Normalise to (-180, 180]. */
export function normAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Math.abs(a) < 1e-9 ? 0 : a;
}

/** The `rotate` style value for an angle (null removes it). Rounded to 0.01°. */
export function angleStyle(deg: number): string | null {
  const a = Math.round(normAngle(deg) * 100) / 100;
  return a === 0 ? null : `${a}deg`;
}

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const r = deg * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function boxFromRect(r: Rect, angle = 0): OrientedBox {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, width: r.width, height: r.height, angle };
}

/** The unrotated rect of a box (what CSS lays out before `rotate`). */
export function boxLocalRect(b: OrientedBox): Rect {
  return { x: b.cx - b.width / 2, y: b.cy - b.height / 2, width: b.width, height: b.height };
}

/** Point on the box for a handle (corners, edge midpoints), rotated into world space. */
export function handlePoint(b: OrientedBox, handle: Handle): Point {
  const { h, v } = handleAxes(handle);
  const local = { x: b.cx + (h * b.width) / 2, y: b.cy + (v * b.height) / 2 };
  return rotatePoint(local, { x: b.cx, y: b.cy }, b.angle);
}

/** Corners in order nw, ne, se, sw. */
export function boxCorners(b: OrientedBox): Point[] {
  return (["nw", "ne", "se", "sw"] as Handle[]).map((h) => handlePoint(b, h));
}

export function boxContains(b: OrientedBox, p: Point, pad = 0): boolean {
  const q = rotatePoint(p, { x: b.cx, y: b.cy }, -b.angle);
  return Math.abs(q.x - b.cx) <= b.width / 2 + pad && Math.abs(q.y - b.cy) <= b.height / 2 + pad;
}

/** Axis-aligned bounds of a rotated box. */
export function boxBounds(b: OrientedBox): Rect {
  const pts = boxCorners(b);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Angle of `p` around `c`, in degrees. */
export function angleAt(c: Point, p: Point): number {
  return Math.atan2(p.y - c.y, p.x - c.x) / RAD;
}

/**
 * New rotation while dragging from `start` to `current` around `center`, beginning at `startAngle`.
 * With `snap` (degrees, e.g. 15 while Shift is held) the result lands on multiples of it.
 */
export function rotationFromDrag(center: Point, start: Point, current: Point, startAngle: number, snap = 0): number {
  const delta = angleAt(center, current) - angleAt(center, start);
  let a = startAngle + delta;
  if (snap > 0) a = Math.round(a / snap) * snap;
  return normAngle(a);
}

/**
 * Resize a rotated box by dragging `handle` by (dx, dy) world units. The drag is projected into the
 * box's own frame, so the opposite edge or corner stays put on screen.
 */
export function resizeBox(start: OrientedBox, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): OrientedBox {
  const local = rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -start.angle);
  const r = resizeRect({ x: -start.width / 2, y: -start.height / 2, width: start.width, height: start.height }, handle, local.x, local.y, opts);
  const shift = rotatePoint({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, { x: 0, y: 0 }, start.angle);
  return { cx: start.cx + shift.x, cy: start.cy + shift.y, width: r.width, height: r.height, angle: start.angle };
}

/** Change of the unrotated top-left corner between two boxes (what left/top must move by). */
export function topLeftDelta(from: OrientedBox, to: OrientedBox): Point {
  return { x: to.cx - to.width / 2 - (from.cx - from.width / 2), y: to.cy - to.height / 2 - (from.cy - from.height / 2) };
}

const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** Resize cursor for a handle on a box rotated by `angle`, picked from the four CSS cursors. */
export function rotatedHandleCursor(handle: Handle, angle: number): string {
  const { h, v } = handleAxes(handle);
  const base = Math.atan2(v, h) / RAD; // e = 0, se = 45, s = 90 ...
  const a = (((base + angle) % 180) + 180) % 180;
  return CURSORS[Math.round(a / 45) % 4];
}

/** Position and rotation of a layer, for repeat duplicate. */
export interface StepTransform {
  left?: number;
  top?: number;
  angle: number;
}

/**
 * The style patch placing a new copy one step further than `copy` (null when nothing changed). The step
 * repeats the offset from source to copy and the extra rotation; the offset itself turns by that
 * rotation too, so repeated copies walk around an arc.
 */
export function nextStep(source: StepTransform, copy: StepTransform): Record<string, string | number | null> | null {
  const patch: Record<string, string | number | null> = {};
  const da = copy.angle - source.angle;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (source.left !== undefined && copy.left !== undefined && source.top !== undefined && copy.top !== undefined) {
    const off = rotatePoint({ x: copy.left - source.left, y: copy.top - source.top }, { x: 0, y: 0 }, da);
    if (Math.abs(off.x) > 0.001 || Math.abs(off.y) > 0.001) {
      patch.left = r2(copy.left + off.x);
      patch.top = r2(copy.top + off.y);
    }
  }
  if (Math.abs(da) > 0.001) patch.rotate = angleStyle(copy.angle + da);
  return Object.keys(patch).length ? patch : null;
}
