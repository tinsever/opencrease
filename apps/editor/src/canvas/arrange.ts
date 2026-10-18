// Align, distribute and tidy up: pure offsets for a list of rects (world units).
import { unionRects, type Point, type Rect } from "./geometry";

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

/** Offsets that align every rect to `bounds` (default: the union of the rects). */
export function alignOffsets(rects: Rect[], kind: AlignKind, bounds: Rect | null = unionRects(rects)): Point[] {
  if (!bounds) return rects.map(() => ({ x: 0, y: 0 }));
  return rects.map((r) => {
    switch (kind) {
      case "left":
        return { x: bounds.x - r.x, y: 0 };
      case "hcenter":
        return { x: bounds.x + bounds.width / 2 - (r.x + r.width / 2), y: 0 };
      case "right":
        return { x: bounds.x + bounds.width - (r.x + r.width), y: 0 };
      case "top":
        return { x: 0, y: bounds.y - r.y };
      case "vcenter":
        return { x: 0, y: bounds.y + bounds.height / 2 - (r.y + r.height / 2) };
      case "bottom":
        return { x: 0, y: bounds.y + bounds.height - (r.y + r.height) };
    }
  });
}

/**
 * Offsets that space rects evenly along an axis: the first and last stay, the gaps between
 * neighbours become equal. With fewer than three rects nothing moves.
 */
export function distributeOffsets(rects: Rect[], axis: DistributeAxis): Point[] {
  const out = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length < 3) return out;
  const pos = (r: Rect) => (axis === "horizontal" ? r.x : r.y);
  const len = (r: Rect) => (axis === "horizontal" ? r.width : r.height);
  const order = rects.map((r, i) => i).sort((a, b) => pos(rects[a]) + len(rects[a]) / 2 - (pos(rects[b]) + len(rects[b]) / 2));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = pos(last) + len(last) - pos(first);
  const total = order.reduce((s, i) => s + len(rects[i]), 0);
  const gap = (span - total) / (order.length - 1);
  let cursor = pos(first);
  for (const i of order) {
    const d = cursor - pos(rects[i]);
    out[i] = axis === "horizontal" ? { x: d, y: 0 } : { x: 0, y: d };
    cursor += len(rects[i]) + gap;
  }
  return out;
}

/** Group rects into rows: a rect joins a row when its vertical centre falls inside the row's band. */
function rowsOf(rects: Rect[]): number[][] {
  const order = rects.map((_, i) => i).sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const rows: Array<{ ids: number[]; top: number; bottom: number }> = [];
  for (const i of order) {
    const r = rects[i];
    const cy = r.y + r.height / 2;
    const row = rows.find((w) => cy >= w.top && cy <= w.bottom);
    if (row) {
      row.ids.push(i);
      row.top = Math.min(row.top, r.y);
      row.bottom = Math.max(row.bottom, r.y + r.height);
    } else rows.push({ ids: [i], top: r.y, bottom: r.y + r.height });
  }
  for (const w of rows) w.ids.sort((a, b) => rects[a].x - rects[b].x);
  return rows.map((w) => w.ids);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Tidy up: put the rects on a grid that keeps their reading order (rows top to bottom, left to right),
 * starting at the selection's top-left corner. Columns are as wide as their widest item, rows as tall as
 * their tallest, and the spacing is the typical gap the selection already has (rounded, never negative).
 */
export function tidyOffsets(rects: Rect[]): Point[] {
  const out = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length < 2) return out;
  const bounds = unionRects(rects)!;
  const grid = rowsOf(rects);

  const hGaps: number[] = [];
  const vGaps: number[] = [];
  for (const row of grid) {
    for (let k = 1; k < row.length; k++) hGaps.push(rects[row[k]].x - (rects[row[k - 1]].x + rects[row[k - 1]].width));
  }
  for (let k = 1; k < grid.length; k++) {
    const prevBottom = Math.max(...grid[k - 1].map((i) => rects[i].y + rects[i].height));
    const top = Math.min(...grid[k].map((i) => rects[i].y));
    vGaps.push(top - prevBottom);
  }
  const hGap = Math.max(0, Math.round(median(hGaps)));
  const vGap = Math.max(0, Math.round(median(vGaps.length ? vGaps : hGaps)));
  const nCols = Math.max(...grid.map((r) => r.length));
  const colW = Array.from({ length: nCols }, (_, c) => Math.max(0, ...grid.map((row) => (row[c] !== undefined ? rects[row[c]].width : 0))));
  const rowH = grid.map((row) => Math.max(...row.map((i) => rects[i].height)));
  let y = bounds.y;
  grid.forEach((row, ri) => {
    let x = bounds.x;
    row.forEach((i, ci) => {
      out[i] = { x: x - rects[i].x, y: y - rects[i].y };
      x += colW[ci] + hGap;
    });
    y += rowH[ri] + vGap;
  });
  return out;
}
