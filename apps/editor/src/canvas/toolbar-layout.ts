// Responsive layout of the floating bottom toolbar and zoom pill (C2 in the UI review).
import type { Tool } from "../state/workspace";
import type { ViewportValue } from "./viewport-math";

export type ToolbarMode = "full" | "compact" | "tight" | "minimal";

export interface ToolbarLayout {
  mode: ToolbarMode;
  /** tools shown inline, in order */
  inline: Tool[];
  /** tools moved into the overflow menu */
  overflow: Tool[];
  separator: boolean;
  /** "Ask agent" shows its label */
  askLabel: boolean;
  /** gap between buttons, px */
  gap: number;
  /** zoom pill shown on its own (otherwise its commands live in the overflow menu) */
  zoomPill: boolean;
}

export const ALL_TOOLS: Tool[] = ["move", "frame", "rect", "text", "pen", "image", "shader"];
/** Less important tools that collapse first. */
export const COLLAPSIBLE: Tool[] = ["pen", "image", "shader"];

const BUTTON = 34;
const PAD = 4;
const SEPARATOR = 5; // 1px line + margins
const ASK_LABEL = 98; // "Ask agent" with icon
const ZOOM_PILL = 56; // pill width incl. text
const EDGE = 16; // pill inset from the canvas edge
const CLEARANCE = 8; // minimum space between toolbar and pill

/** Width of a toolbar with the given content. */
export function toolbarWidth(l: Omit<ToolbarLayout, "mode" | "zoomPill">): number {
  const buttons = l.inline.length + (l.overflow.length ? 1 : 0); // + overflow button
  const items = buttons + 1; // + ask agent
  const ask = l.askLabel ? ASK_LABEL : BUTTON;
  return PAD * 2 + buttons * BUTTON + ask + (items - 1 + (l.separator ? 1 : 0)) * l.gap + (l.separator ? SEPARATOR : 0);
}

/** The toolbar is centred; it must leave room for the zoom pill on the right. */
function fits(width: number, canvasWidth: number, withPill: boolean): boolean {
  const side = withPill ? EDGE + ZOOM_PILL + CLEARANCE : 8;
  return width + side * 2 <= canvasWidth;
}

/** Pick the richest toolbar that fits a canvas of `canvasWidth` px. */
export function toolbarLayout(canvasWidth: number): ToolbarLayout {
  const inlineAll = ALL_TOOLS;
  const inlineFew = ALL_TOOLS.filter((t) => !COLLAPSIBLE.includes(t));
  const candidates: ToolbarLayout[] = [
    { mode: "full", inline: inlineAll, overflow: [], separator: true, askLabel: true, gap: 2, zoomPill: true },
    { mode: "compact", inline: inlineAll, overflow: [], separator: false, askLabel: false, gap: 0, zoomPill: true },
    { mode: "tight", inline: inlineFew, overflow: COLLAPSIBLE, separator: false, askLabel: false, gap: 0, zoomPill: true },
  ];
  for (const c of candidates) if (fits(toolbarWidth(c), canvasWidth, c.zoomPill)) return c;
  return { mode: "minimal", inline: inlineFew, overflow: COLLAPSIBLE, separator: false, askLabel: false, gap: 0, zoomPill: false };
}

/** Zoom at which the pixel grid appears. */
export const PIXEL_GRID_MIN_ZOOM = 8;

/**
 * Background geometry for a 1px grid aligned to world pixels, or null below the threshold.
 * Lines sit at screen x = vp.x + k * zoom (and likewise for y).
 */
export function pixelGrid(vp: ViewportValue): { size: number; offsetX: number; offsetY: number } | null {
  if (vp.zoom < PIXEL_GRID_MIN_ZOOM) return null;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  return { size: vp.zoom, offsetX: mod(vp.x, vp.zoom), offsetY: mod(vp.y, vp.zoom) };
}
