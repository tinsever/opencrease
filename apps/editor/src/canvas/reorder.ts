// Where a dragged layer lands among flex (or block) siblings.
import type { Point, Rect } from "./geometry";

export interface InsertSlot {
  /** index among the given sibling rects (0..n) */
  index: number;
  /** insertion line in the same space as the rects */
  line: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Insertion index for `pointer` among `siblings` laid out along `axis`. Wrapped layouts pick the
 * nearest row/column first. `container` is used for empty containers and line extents.
 */
export function computeInsertSlot(siblings: Rect[], pointer: Point, axis: "row" | "column", container: Rect): InsertSlot {
  if (siblings.length === 0) {
    const pad = 4;
    return axis === "row"
      ? { index: 0, line: { x1: container.x + pad, y1: container.y + pad, x2: container.x + pad, y2: container.y + container.height - pad } }
      : { index: 0, line: { x1: container.x + pad, y1: container.y + pad, x2: container.x + container.width - pad, y2: container.y + pad } };
  }
  const main = axis === "row" ? "x" : "y";
  const cross = axis === "row" ? "y" : "x";
  const mainSize = axis === "row" ? "width" : "height";
  const crossSize = axis === "row" ? "height" : "width";

  // group siblings into lines (rows for "row", columns for "column") by cross-axis overlap
  const lines: number[][] = [];
  siblings.forEach((r, i) => {
    const line = lines.find((l) => {
      const ref = siblings[l[0]];
      return r[cross] < ref[cross] + ref[crossSize] && ref[cross] < r[cross] + r[crossSize];
    });
    if (line) line.push(i);
    else lines.push([i]);
  });
  // the line nearest the pointer on the cross axis
  let bestLine = lines[0];
  let bestDist = Infinity;
  for (const l of lines) {
    const lo = Math.min(...l.map((i) => siblings[i][cross]));
    const hi = Math.max(...l.map((i) => siblings[i][cross] + siblings[i][crossSize]));
    const p = pointer[cross];
    const d = p < lo ? lo - p : p > hi ? p - hi : 0;
    if (d < bestDist) {
      bestDist = d;
      bestLine = l;
    }
  }
  const ordered = [...bestLine].sort((a, b) => a - b);
  let index = ordered[ordered.length - 1] + 1;
  for (const i of ordered) {
    const r = siblings[i];
    if (pointer[main] < r[main] + r[mainSize] / 2) {
      index = i;
      break;
    }
  }

  const lo = Math.min(...ordered.map((i) => siblings[i][cross]));
  const hi = Math.max(...ordered.map((i) => siblings[i][cross] + siblings[i][crossSize]));
  const before = ordered.includes(index - 1) ? siblings[index - 1] : undefined;
  const after = ordered.includes(index) ? siblings[index] : undefined;
  let at: number;
  if (before && after) at = (before[main] + before[mainSize] + after[main]) / 2;
  else if (before) at = before[main] + before[mainSize] + 2;
  else if (after) at = after[main] - 2;
  else at = container[main];
  const line =
    axis === "row" ? { x1: at, y1: lo, x2: at, y2: hi } : { x1: lo, y1: at, x2: hi, y2: at };
  return { index, line };
}
