// Browser SVG matrices include nested groups, viewBox fitting and CSS transforms.
import { canvasOrigin, getNodeElement, getViewportLive } from "../canvas/registry";
import type { Matrix } from "./path";

export function svgScreenMatrix(id: string): Matrix | null {
  if (typeof SVGGraphicsElement === "undefined") return null;
  const element = getNodeElement(id);
  if (!(element instanceof SVGGraphicsElement)) return null;
  const m = element.getScreenCTM();
  if (!m || Math.abs(m.a * m.d - m.b * m.c) < 1e-12) return null;
  const origin = canvasOrigin();
  return [m.a, m.b, m.c, m.d, m.e - origin.x, m.f - origin.y];
}

export function svgWorldMatrix(id: string): Matrix | null {
  const m = svgScreenMatrix(id);
  if (!m) return null;
  const vp = getViewportLive();
  return [m[0] / vp.zoom, m[1] / vp.zoom, m[2] / vp.zoom, m[3] / vp.zoom, (m[4] - vp.x) / vp.zoom, (m[5] - vp.y) / vp.zoom];
}
