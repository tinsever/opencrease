// Snapping of moving and resizing rects against other rects' edges and centres.
// All values are world units; callers convert the screen threshold (6px) by dividing by zoom.
import { handleAxes, type Handle, type Rect } from "./geometry";

/** A guide line in world space. Vertical guides have a fixed x, horizontal ones a fixed y. */
export interface Guide {
  orientation: "vertical" | "horizontal";
  /** x for vertical, y for horizontal */
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

function xs(r: Rect): number[] {
  return [r.x, r.x + r.width / 2, r.x + r.width];
}
function ys(r: Rect): number[] {
  return [r.y, r.y + r.height / 2, r.y + r.height];
}

interface AxisMatch {
  offset: number;
  value: number;
}

/** Best offset bringing any of `moving` values onto any of `targets` within `threshold`. */
function bestMatch(moving: number[], targets: number[], threshold: number): AxisMatch | null {
  let best: AxisMatch | null = null;
  for (const m of moving) {
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, value: t };
    }
  }
  return best;
}

function guidesFor(rect: Rect, targets: Rect[], axis: "x" | "y", value: number): Guide | null {
  const eps = 0.5;
  const hits = targets.filter((t) => (axis === "x" ? xs(t) : ys(t)).some((v) => Math.abs(v - value) < eps));
  if (hits.length === 0) return null;
  const all = [rect, ...hits];
  if (axis === "x") {
    return {
      orientation: "vertical",
      at: value,
      from: Math.min(...all.map((r) => r.y)),
      to: Math.max(...all.map((r) => r.y + r.height)),
    };
  }
  return {
    orientation: "horizontal",
    at: value,
    from: Math.min(...all.map((r) => r.x)),
    to: Math.max(...all.map((r) => r.x + r.width)),
  };
}

/** Snap a rect that is being moved. Returns the correction to add to the proposed position. */
export function snapMove(moving: Rect, targets: Rect[], threshold: number): SnapResult {
  const mx = bestMatch(xs(moving), targets.flatMap(xs), threshold);
  const my = bestMatch(ys(moving), targets.flatMap(ys), threshold);
  const dx = mx?.offset ?? 0;
  const dy = my?.offset ?? 0;
  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  if (mx) {
    // a moved rect can touch the same target line with several of its own lines; draw each once
    for (const v of new Set(xs(snapped).filter((x) => targets.some((t) => xs(t).some((tx) => Math.abs(tx - x) < 0.5))))) {
      const g = guidesFor(snapped, targets, "x", v);
      if (g) guides.push(g);
    }
  }
  if (my) {
    for (const v of new Set(ys(snapped).filter((y) => targets.some((t) => ys(t).some((ty) => Math.abs(ty - y) < 0.5))))) {
      const g = guidesFor(snapped, targets, "y", v);
      if (g) guides.push(g);
    }
  }
  return { dx, dy, guides };
}

/**
 * Snap the edges a resize handle moves. Returns the snapped rect (only moving edges change) and guides.
 */
export function snapResize(rect: Rect, handle: Handle, targets: Rect[], threshold: number): { rect: Rect; guides: Guide[] } {
  const { h, v } = handleAxes(handle);
  let { x, y, width, height } = rect;
  const tx = targets.flatMap(xs);
  const ty = targets.flatMap(ys);
  if (h !== 0) {
    const edge = h === -1 ? x : x + width;
    const m = bestMatch([edge], tx, threshold);
    if (m) {
      if (h === -1) {
        x += m.offset;
        width -= m.offset;
      } else width += m.offset;
    }
  }
  if (v !== 0) {
    const edge = v === -1 ? y : y + height;
    const m = bestMatch([edge], ty, threshold);
    if (m) {
      if (v === -1) {
        y += m.offset;
        height -= m.offset;
      } else height += m.offset;
    }
  }
  const out = { x, y, width, height };
  const guides: Guide[] = [];
  if (h !== 0) {
    const g = guidesFor(out, targets, "x", h === -1 ? x : x + width);
    if (g) guides.push(g);
  }
  if (v !== 0) {
    const g = guidesFor(out, targets, "y", v === -1 ? y : y + height);
    if (g) guides.push(g);
  }
  return { rect: out, guides };
}
