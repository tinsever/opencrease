// Where new or pasted page-level layers go.
import { rectsIntersect, unionRects, type Rect } from "./geometry";

/**
 * Keep `incoming` (world rect of the pasted group) where it is if it overlaps nothing; otherwise move it
 * to the right of everything on the page, top-aligned with where it was. Returns the offset to apply.
 */
export function placeBesideExisting(incoming: Rect, existing: Rect[], gap = 80): { dx: number; dy: number } {
  if (!existing.some((r) => rectsIntersect(r, incoming))) return { dx: 0, dy: 0 };
  const all = unionRects(existing)!;
  return { dx: all.x + all.width + gap - incoming.x, dy: 0 };
}

/** Rect of `size` centred on a world point, snapped to whole pixels. */
export function centredAt(center: { x: number; y: number }, size: { width: number; height: number }): Rect {
  return {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
    width: size.width,
    height: size.height,
  };
}

/** Fit an intrinsic image size inside a box, keeping aspect ratio, never upscaling. */
export function fitSize(size: { width: number; height: number }, max: { width: number; height: number }): { width: number; height: number } {
  const k = Math.min(1, max.width / Math.max(1, size.width), max.height / Math.max(1, size.height));
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}
