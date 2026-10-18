// Pure rectangle math shared by the overlay, snapping and interactions.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize handles: corners and edges, named by compass direction. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CORNER_HANDLES: Handle[] = ["nw", "ne", "se", "sw"];
export const EDGE_HANDLES: Handle[] = ["n", "e", "s", "w"];

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectsEqual(a: Rect | undefined | null, b: Rect | undefined | null, eps = 0.01): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.width - b.width) < eps && Math.abs(a.height - b.height) < eps
  );
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

/** Which edges a handle moves. -1 = start edge (left/top), 1 = end edge (right/bottom), 0 = axis untouched. */
export function handleAxes(handle: Handle): { h: -1 | 0 | 1; v: -1 | 0 | 1 } {
  const h = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const v = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  return { h, v };
}

export interface ResizeOptions {
  /** keep the start aspect ratio (Shift) */
  keepAspect?: boolean;
  /** resize symmetrically around the centre (Alt) */
  fromCenter?: boolean;
  minSize?: number;
}

/**
 * New rect after dragging `handle` by (dx, dy) world units from `start`. Dragging past the opposite edge
 * clamps at `minSize` instead of flipping (flipping would need the node to change position semantics).
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const min = opts.minSize ?? 1;
  const { h, v } = handleAxes(handle);
  const k = opts.fromCenter ? 2 : 1;
  let width = start.width + h * dx * k;
  let height = start.height + v * dy * k;
  if (h === 0) width = start.width;
  if (v === 0) height = start.height;

  if (opts.keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (h !== 0 && v !== 0) {
      // corner: follow the axis that moved relatively more
      if (Math.abs(width / start.width) >= Math.abs(height / start.height)) height = width / ratio;
      else width = height * ratio;
    } else if (h !== 0) {
      height = width / ratio;
    } else if (v !== 0) {
      width = height * ratio;
    }
  }

  width = Math.max(min, width);
  height = Math.max(min, height);

  let x: number;
  let y: number;
  if (opts.fromCenter) {
    x = start.x + (start.width - width) / 2;
    y = start.y + (start.height - height) / 2;
  } else {
    x = h === -1 ? start.x + start.width - width : h === 0 && opts.keepAspect ? start.x + (start.width - width) / 2 : start.x;
    y = v === -1 ? start.y + start.height - height : v === 0 && opts.keepAspect ? start.y + (start.height - height) / 2 : start.y;
  }
  return { x, y, width, height };
}

/** Cursor for a resize handle. */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "nesw-resize";
  }
}

export function round(n: number, step = 1): number {
  return Math.round(n / step) * step;
}

/** Format a measurement for badges: integers stay integers, others get at most one decimal. */
export function formatNumber(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
