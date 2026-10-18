// Pure geometry for on-canvas flex gap handles.
import type { StyleMap } from "@opencrease/model";
import type { Point, Rect } from "./geometry";

/** How long the pointer must rest on a gap band before it becomes a gap handle. */
export const GAP_ARM_DELAY_MS = 250;
/** Strips up to this many screen px are grabbable across their whole width. */
export const GAP_FULL_BAND_MAX = 24;
/** Width of the grabbable centre band of a wider strip, screen px. */
export const GAP_CENTRE_BAND = 12;
/** Narrow strips (or zero gaps) still get at least this much to aim at. */
export const GAP_MIN_BAND = 8;

/**
 * Gap handles only make sense when `gap` is what spaces the children. With space-between/around/evenly
 * the visible spacing comes from free space, and dragging the gap would change nothing you can see.
 */
export function gapHandlesApply(styles: StyleMap): boolean {
  const j = String(styles.justifyContent ?? "");
  return !/space-(between|around|evenly)/.test(j);
}

/** Strips between consecutive flow children on the same line (world or screen space, same as input). */
export function gapStrips(kids: Rect[], axis: "row" | "column"): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < kids.length - 1; i++) {
    const a = kids[i];
    const b = kids[i + 1];
    if (axis === "row") {
      if (b.x < a.x + a.width - 0.5) continue; // wrapped onto a new line
      const top = Math.min(a.y, b.y);
      out.push({ x: a.x + a.width, y: top, width: b.x - (a.x + a.width), height: Math.max(a.y + a.height, b.y + b.height) - top });
    } else {
      if (b.y < a.y + a.height - 0.5) continue;
      const left = Math.min(a.x, b.x);
      out.push({ x: left, y: a.y + a.height, width: Math.max(a.x + a.width, b.x + b.width) - left, height: b.y - (a.y + a.height) });
    }
  }
  return out;
}

/**
 * The grabbable band of a strip in screen space: the whole strip when it is narrow (at least
 * GAP_MIN_BAND, centred), otherwise a GAP_CENTRE_BAND wide band in the middle.
 */
export function gapGrabBand(strip: Rect, axis: "row" | "column"): Rect {
  const main = axis === "row" ? strip.width : strip.height;
  const band = main <= GAP_FULL_BAND_MAX ? Math.max(main, GAP_MIN_BAND) : GAP_CENTRE_BAND;
  const offset = (main - band) / 2;
  return axis === "row"
    ? { x: strip.x + offset, y: strip.y, width: band, height: strip.height }
    : { x: strip.x, y: strip.y + offset, width: strip.width, height: band };
}

/** Index of the band containing `p`, or null. */
export function bandAt(bands: Rect[], p: Point): number | null {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return i;
  }
  return null;
}
