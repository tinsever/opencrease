// Pure viewport math. A viewport maps world to canvas-local screen space:
//   screen = world * zoom + (x, y)
import type { Point, Rect } from "./geometry";

export interface ViewportValue {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

/** Preset steps for Cmd+/Cmd- and the zoom menu. */
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 32, 64, 128, 256];

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toScreen(vp: ViewportValue, p: Point): Point {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

export function toWorld(vp: ViewportValue, p: Point): Point {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function rectToScreen(vp: ViewportValue, r: Rect): Rect {
  return { x: r.x * vp.zoom + vp.x, y: r.y * vp.zoom + vp.y, width: r.width * vp.zoom, height: r.height * vp.zoom };
}

export function rectToWorld(vp: ViewportValue, r: Rect): Rect {
  return { x: (r.x - vp.x) / vp.zoom, y: (r.y - vp.y) / vp.zoom, width: r.width / vp.zoom, height: r.height / vp.zoom };
}

/** Zoom to `zoom` keeping the world point under the canvas-local `anchor` fixed. */
export function zoomAt(vp: ViewportValue, anchor: Point, zoom: number): ViewportValue {
  const z = clampZoom(zoom);
  const world = toWorld(vp, anchor);
  return { x: anchor.x - world.x * z, y: anchor.y - world.y * z, zoom: z };
}

/** Next preset step above (dir 1) or below (dir -1) the current zoom. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom * 1.001) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < zoom * 0.999) return ZOOM_STEPS[i];
  return MIN_ZOOM;
}

/** Viewport that fits `rect` (world) into a canvas of `size`, with `padding` screen px, never above `maxZoom`. */
export function fitRect(
  rect: Rect,
  size: { width: number; height: number },
  opts: { padding?: number; maxZoom?: number; insetBottom?: number } = {},
): ViewportValue {
  const padding = opts.padding ?? 64;
  const insetBottom = opts.insetBottom ?? 0;
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2 - insetBottom);
  const zoom = clampZoom(
    Math.min(opts.maxZoom ?? 1, availW / Math.max(1, rect.width), availH / Math.max(1, rect.height)),
  );
  const x = (size.width - rect.width * zoom) / 2 - rect.x * zoom;
  const y = (size.height - insetBottom - rect.height * zoom) / 2 - rect.y * zoom;
  return { x, y, zoom };
}

/** Normalise a wheel event delta to pixels. */
export function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 400;
  return delta;
}

/** Zoom factor for a wheel/pinch delta. Pinch (ctrlKey) deltas are small and frequent. */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
  const d = Math.max(-100, Math.min(100, deltaY));
  return Math.exp(-d * (pinch ? 0.012 : 0.004));
}
