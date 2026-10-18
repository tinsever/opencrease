// Where new artboards go on the canvas. Pure.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ARTBOARD_GAP = 80;

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/**
 * Free spot for a new artboard of `size`: to the right of the rightmost artboard, aligned with the
 * top of the existing row. With `near`, try right of that rect first (used for duplicates).
 */
export function findFreeSpot(existing: Rect[], size: { width: number; height: number }, near?: Rect, gap = ARTBOARD_GAP): { x: number; y: number } {
  const rects = existing.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  if (rects.length === 0) return near ? { x: near.x + near.width + gap, y: near.y } : { x: 0, y: 0 };
  if (near) {
    const candidate = { x: near.x + near.width + gap, y: near.y, ...size };
    if (!rects.some((r) => overlaps(candidate, r, gap / 2))) return { x: candidate.x, y: candidate.y };
  }
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + Math.max(0, r.width)));
  return { x: Math.round(right + gap), y: Math.round(top) };
}
